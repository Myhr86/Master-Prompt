"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { audit } from "@/lib/audit";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";
import { sanitizeUpload } from "@/lib/images/compose";
import { downloadMedia, removeMedia } from "@/lib/images/storage";
import { saveAsset } from "@/lib/images/service";
import { uuidSchema } from "@/lib/posts/validation";
import { analyzeImage, MEDIA_CATEGORIES } from "@/lib/media/analyze";
import { callClaudeStructured } from "@/lib/ai/claude";
import { getSettings } from "@/lib/data";
import { integrations } from "@/lib/env";

function migrationHint(err: { code?: string; message?: string } | null | undefined) {
  const m = err?.message ?? "";
  if (err?.code === "42703" || err?.code === "PGRST204" || /in_library|analysis_status|description/.test(m)) {
    return new UserFacingError("Databasen mangler oppdateringen for mediebanken. Kjør supabase/migrations/20261109000005_media_library.sql i Supabase → SQL Editor.");
  }
  return null;
}

/** Laster opp ETT bilde (allerede nedskalert i nettleseren). Analysen kjøres separat. */
export async function uploadLibraryImage(fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`library-upload:${owner.id}`, 300, 3600);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Ingen fil mottatt.");
    let clean;
    try {
      clean = await sanitizeUpload(Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      throw new UserFacingError(`${file.name}: ${(e as Error).message}`);
    }
    const asset = await saveAsset({
      data: clean.data,
      mime: clean.mimeType,
      folder: "uploads",
      kind: "upload",
      is_ai_generated: false,
      contains_real_product_photo: false,
      prompt: null,
      provider: null,
      format: "original",
      product_id: null,
      source_asset_id: null,
      source_product_image_id: null,
    });
    const supabase = await createClient();
    const { error } = await supabase.from("media_assets").update({ in_library: true, analysis_status: integrations().anthropic ? "pending" : "none" }).eq("id", asset.id);
    if (error) {
      await supabase.from("media_assets").delete().eq("id", asset.id);
      await removeMedia([asset.storage_path]);
      throw migrationHint(error) ?? error;
    }
    return { ok: true, data: { id: asset.id } };
  } catch (err) {
    return toActionError(err, "uploadLibraryImage");
  }
}

/** Claude ser på bildet én gang og lagrer beskrivelse, kategori og stikkord. */
export async function analyzeLibraryAsset(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    if (!integrations().anthropic) throw new UserFacingError("Claude er ikke konfigurert (ANTHROPIC_API_KEY).");
    await enforceRateLimit(`library-analyze:${owner.id}`, 300, 3600);
    const supabase = await createClient();
    const { data: asset, error } = await supabase.from("media_assets").select("id, storage_path").eq("id", id).single();
    if (error) throw migrationHint(error) ?? error;
    const [settings, { data: products }] = await Promise.all([getSettings(), supabase.from("products").select("id, name").order("name")]);
    try {
      const a = await analyzeImage(await downloadMedia(asset.storage_path), products ?? [], callClaudeStructured, settings.ai_model);
      const { error: upErr } = await supabase
        .from("media_assets")
        .update({
          description: a.description,
          category: a.category,
          tags: a.tags,
          product_id: a.product_id,
          people_visible: a.people_visible,
          analysis_status: "done",
          analysis_error: null,
          analyzed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (upErr) throw upErr;
      await supabase.from("ai_generations").insert({ kind: "image", model: a.model, status: "succeeded", request: { asset_id: id, purpose: "media_library_analysis" }, created_by: owner.id });
    } catch (e) {
      await supabase.from("media_assets").update({ analysis_status: "failed", analysis_error: (e as Error).message?.slice(0, 300) }).eq("id", id);
      throw e;
    }
    revalidatePath("/mediebank");
    return { ok: true, message: "Bildet er beskrevet." };
  } catch (err) {
    return toActionError(err, "analyzeLibraryAsset");
  }
}

/** ID-er som venter på (eller feilet i) analyse. */
export async function pendingLibraryIds(): Promise<string[]> {
  await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.from("media_assets").select("id").eq("in_library", true).in("analysis_status", ["pending", "failed", "none"]).order("created_at").limit(200);
  return (data ?? []).map((r) => r.id);
}

const infoSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().max(1000),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(15),
  category: z.enum(MEDIA_CATEGORIES).nullable(),
  product_id: z.string().uuid().nullable(),
  people_visible: z.boolean(),
});

export async function updateLibraryInfo(input: z.input<typeof infoSchema>): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const d = infoSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase
      .from("media_assets")
      .update({ description: d.description || null, tags: [...new Set(d.tags)], category: d.category, product_id: d.product_id, people_visible: d.people_visible, analysis_status: "done" })
      .eq("id", d.id)
      .eq("in_library", true);
    if (error) throw error;
    await audit("media.library_edited", { actorId: owner.id, entity: "media", entityId: d.id });
    revalidatePath("/mediebank");
    return { ok: true, message: "Lagret." };
  } catch (err) {
    return toActionError(err, "updateLibraryInfo");
  }
}
