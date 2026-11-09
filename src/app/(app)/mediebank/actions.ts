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
import { analyzeImage, analyzeVideoFrames, MEDIA_CATEGORIES } from "@/lib/media/analyze";
import { randomUUID } from "node:crypto";
import { createAdminClient, MEDIA_BUCKET } from "@/lib/supabase/admin";
import { uploadMedia } from "@/lib/images/storage";
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
    const { data: asset, error } = await supabase.from("media_assets").select("*").eq("id", id).single();
    if (error) throw migrationHint(error) ?? error;
    const [settings, { data: products }] = await Promise.all([getSettings(), supabase.from("products").select("id, name").order("name")]);
    try {
      // Video: bruk miniatyrbildet (stillbildene fra opplastingen lagres ikke).
      const isVideo = asset.media_type === "video";
      if (isVideo && !asset.thumbnail_path) throw new UserFacingError("Videoen har ikke miniatyrbilde og kan ikke beskrives automatisk. Skriv beskrivelsen selv.");
      const a = isVideo
        ? await analyzeVideoFrames([await downloadMedia(asset.thumbnail_path)], asset.duration_seconds === null ? null : Number(asset.duration_seconds), products ?? [], callClaudeStructured, settings.ai_model)
        : await analyzeImage(await downloadMedia(asset.storage_path), products ?? [], callClaudeStructured, settings.ai_model);
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

const MAX_VIDEO_MB = Number(process.env.NEXT_PUBLIC_MAX_VIDEO_MB ?? 50);
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };

/**
 * Steg 1 for video: lager en engangslenke slik at nettleseren laster videoen
 * rett til den private bøtta (utenom Vercel, som bare tar imot ca. 4,5 MB).
 */
export async function createVideoUpload(input: { name: string; size: number; type: string }): Promise<ActionResult<{ path: string; token: string }>> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`video-upload:${owner.id}`, 60, 3600);
    const ext = VIDEO_TYPES[input.type];
    if (!ext) throw new UserFacingError(`${input.name}: kun MP4- og MOV-video støttes.`);
    if (!Number.isFinite(input.size) || input.size <= 0) throw new UserFacingError(`${input.name}: tom fil.`);
    if (input.size > MAX_VIDEO_MB * 1024 * 1024) {
      throw new UserFacingError(`${input.name}: videoen er ${Math.round(input.size / 1024 / 1024)} MB. Grensen er ${MAX_VIDEO_MB} MB – ta opp i 1080p, eller del opp videoen.`);
    }
    const now = new Date();
    const path = `uploads/videos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
    const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new UserFacingError(`Kunne ikke starte opplasting: ${error?.message ?? "ukjent feil"}`);
    return { ok: true, data: { path: data.path, token: data.token } };
  } catch (err) {
    return toActionError(err, "createVideoUpload");
  }
}

/**
 * Steg 2 for video: kontrollerer at filen ligger i lagringen, lagrer
 * miniatyrbilde og registrerer videoen. Claude beskriver stillbildene.
 */
export async function registerVideo(fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const owner = await requireOwner();
    const path = z.string().regex(/^uploads\/videos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(mp4|mov)$/).parse(fd.get("path"));
    const num = (k: string) => {
      const v = Number(fd.get(k));
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const duration = num("duration");
    const width = num("width");
    const height = num("height");
    const frames = fd.getAll("frames").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 6);

    // Filen må finnes i bøtta (lastet opp via engangslenken).
    const admin = createAdminClient();
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const { data: listed } = await admin.storage.from(MEDIA_BUCKET).list(dir, { search: name, limit: 1 });
    const obj = listed?.find((o) => o.name === name);
    if (!obj) throw new UserFacingError("Fant ikke den opplastede videoen. Prøv igjen.");
    const mime = (obj.metadata as { mimetype?: string } | null)?.mimetype ?? (path.endsWith(".mov") ? "video/quicktime" : "video/mp4");

    // Miniatyrbilde fra midten av videoen.
    const frameBuffers: Buffer[] = [];
    for (const f of frames) {
      try {
        frameBuffers.push((await sanitizeUpload(Buffer.from(await f.arrayBuffer()))).data);
      } catch {
        /* ugyldig stillbilde ignoreres */
      }
    }
    const thumb = frameBuffers[Math.floor(frameBuffers.length / 2)];
    const thumbnailPath = thumb ? await uploadMedia(thumb, "image/jpeg", "uploads") : null;

    const supabase = await createClient();
    const ai = integrations().anthropic && frameBuffers.length > 0;
    const { data: asset, error } = await supabase
      .from("media_assets")
      .insert({
        storage_path: path,
        kind: "upload",
        media_type: "video",
        mime_type: mime,
        duration_seconds: duration,
        width,
        height,
        thumbnail_path: thumbnailPath,
        format: "original",
        in_library: true,
        analysis_status: ai ? "pending" : "none",
      })
      .select("id")
      .single();
    if (error) {
      await admin.storage.from(MEDIA_BUCKET).remove([path, ...(thumbnailPath ? [thumbnailPath] : [])]);
      throw migrationHint(error) ?? (error.code === "PGRST204" || error.code === "42703"
        ? new UserFacingError("Databasen mangler oppdateringen for video. Kjør supabase/migrations/20261109000009_video.sql i Supabase → SQL Editor.")
        : error);
    }

    if (ai) {
      try {
        const [settings, { data: products }] = await Promise.all([getSettings(), supabase.from("products").select("id, name").order("name")]);
        const a = await analyzeVideoFrames(frameBuffers, duration, products ?? [], callClaudeStructured, settings.ai_model);
        await supabase
          .from("media_assets")
          .update({ description: a.description, category: a.category, tags: a.tags, product_id: a.product_id, people_visible: a.people_visible, analysis_status: "done", analyzed_at: new Date().toISOString() })
          .eq("id", asset.id);
        await supabase.from("ai_generations").insert({ kind: "image", model: a.model, status: "succeeded", request: { asset_id: asset.id, purpose: "video_analysis", frames: frameBuffers.length }, created_by: owner.id });
      } catch (e) {
        await supabase.from("media_assets").update({ analysis_status: "failed", analysis_error: (e as Error).message?.slice(0, 300) }).eq("id", asset.id);
      }
    }
    await audit("media.video_uploaded", { actorId: owner.id, entity: "media", entityId: asset.id, details: { duration, width, height } });
    revalidatePath("/mediebank");
    return { ok: true, data: { id: asset.id } };
  } catch (err) {
    return toActionError(err, "registerVideo");
  }
}
