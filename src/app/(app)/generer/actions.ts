"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { audit } from "@/lib/audit";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { loadGenerationContext } from "@/lib/ai/context";
import { generatePosts } from "@/lib/ai/generator";
import { callClaudeStructured } from "@/lib/ai/claude";
import { POST_TYPES } from "@/lib/ai/schemas";


/** Felles: hent kontekst, la Claude skrive, kontroller og lagre som PENDING_APPROVAL. */
async function generateAndSave(ctxInput: Parameters<typeof loadGenerationContext>[0], ownerId: string) {
  const ctx = await loadGenerationContext(ctxInput);
  const out = await generatePosts(ctx, callClaudeStructured);
  const imagePaths = new Map<string, string>();
  if (out.posts.some((p) => p.suggested_image_id)) {
    const supabase = await createClient();
    const ids = out.posts.map((p) => p.suggested_image_id).filter(Boolean) as string[];
    const { data } = await supabase.from("product_images").select("id, storage_path").in("id", ids);
    for (const r of data ?? []) imagePaths.set(r.id, r.storage_path);
  }

  const batchId = randomUUID();
  const supabase = await createClient();
  const rows = out.posts.map((p) => ({
    title: p.title,
    content: p.content,
    hashtags: p.hashtags,
    link_url: p.link_url,
    product_id: p.product_id,
    image_path: p.suggested_image_id ? imagePaths.get(p.suggested_image_id) ?? null : null,
    post_type: p.post_type,
    image_suggestion: p.image_suggestion,
    rationale: p.rationale,
    quality: p.quality,
    variants: p.variants.slice(0, 3).map((v) => ({ title: v.title, content: v.body })),
    verification_notes: p.warnings,
    scheduled_at: p.scheduled_at,
    // Databasen tvinger uansett status PENDING_APPROVAL for AI-innhold.
    status: "PENDING_APPROVAL",
    generated_by: "ai",
    ai_model: out.model,
    generation_batch_id: batchId,
  }));
  const { error } = await supabase.from("posts").insert(rows);
  if (error) throw error;
  await supabase.from("ai_generations").insert({
    kind: "posts",
    model: out.model,
    status: "succeeded",
    request: { count: ctxInput.count, postTypes: ctxInput.postTypes, productIds: ctxInput.productIds, startDate: ctxInput.startDate, quick: Boolean(ctxInput.skipBusyDays) },
    response: { planning_notes: out.planning_notes, post_count: rows.length },
    usage: out.usage as object,
    created_by: ownerId,
  });
  const { data: created } = await supabase.from("posts").select("id").eq("generation_batch_id", batchId).order("scheduled_at");
  return { batchId, count: rows.length, ids: (created ?? []).map((r) => r.id as string), planningNotes: out.planning_notes };
}

const schema = z.object({
  count: z.coerce.number().int().min(1).max(7),
  startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  postTypes: z.array(z.enum(POST_TYPES)).max(10),
  productIds: z.array(z.string().uuid()).max(20),
  instructions: z.string().max(1500).optional(),
});

export async function generateWeek(_prev: ActionResult<{ batchId: string; count: number }> | undefined, formData: FormData): Promise<ActionResult<{ batchId: string; count: number }>> {
  let ownerId: string | null = null;
  try {
    const owner = await requireOwner();
    ownerId = owner.id;
    const input = schema.parse({
      count: formData.get("count") ?? 3,
      startDate: formData.get("startDate") ?? "",
      postTypes: formData.getAll("postTypes"),
      productIds: formData.getAll("productIds"),
      instructions: formData.get("instructions") ?? "",
    });
    await enforceRateLimit(`ai:${owner.id}`, 20, 3600);

    const res = await generateAndSave({ ...input, startDate: input.startDate || undefined }, owner.id);
    await audit("ai.posts_generated", { actorId: owner.id, entity: "generation", entityId: res.batchId, details: { count: res.count } });
    revalidatePath("/", "layout");
    return { ok: true, message: `${res.count} nye forslag venter på din godkjenning. ${res.planningNotes}`, data: { batchId: res.batchId, count: res.count } };
  } catch (err) {
    if (ownerId) {
      try {
        const supabase = await createClient();
        await supabase.from("ai_generations").insert({ kind: "posts", model: "ukjent", status: "failed", error: (err as Error).message?.slice(0, 500), created_by: ownerId });
      } catch {
        /* logging skal aldri stoppe feilmeldingen */
      }
    }
    return toActionError(err, "generateWeek");
  }
}

/**
 * «Foreslå ett innlegg for meg»: Claude velger selv det mest naturlige
 * innlegget nå, lagt på neste ledige publiseringsdag. Lagres som
 * PENDING_APPROVAL – eieren må fortsatt godkjenne.
 */
export async function suggestOne(wish: string): Promise<ActionResult<{ id: string }>> {
  let ownerId: string | null = null;
  try {
    const owner = await requireOwner();
    ownerId = owner.id;
    const extra = z.string().trim().max(500).parse(wish ?? "");
    await enforceRateLimit(`ai:${owner.id}`, 20, 3600);
    const instructions = [
      "Foreslå det ENE innlegget som er mest naturlig og verdifullt å publisere nå.",
      "Velg selv innleggstype, produkt og vinkel ut fra hva som nylig er publisert (unngå gjentakelser), hva som ikke har vært vist på en stund, årstiden og kommende anledninger.",
      extra ? `Eierens ønske: ${extra}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const res = await generateAndSave({ count: 1, postTypes: [], productIds: [], instructions, skipBusyDays: true }, owner.id);
    await audit("ai.post_suggested", { actorId: owner.id, entity: "generation", entityId: res.batchId });
    revalidatePath("/", "layout");
    const id = res.ids[0];
    if (!id) return { ok: false, error: "Claude laget ikke noe forslag. Prøv igjen." };
    return { ok: true, message: "Forslaget er klart.", data: { id } };
  } catch (err) {
    if (ownerId) {
      try {
        const supabase = await createClient();
        await supabase.from("ai_generations").insert({ kind: "posts", model: "ukjent", status: "failed", error: (err as Error).message?.slice(0, 500), created_by: ownerId });
      } catch {
        /* logging skal aldri stoppe feilmeldingen */
      }
    }
    return toActionError(err, "suggestOne");
  }
}
