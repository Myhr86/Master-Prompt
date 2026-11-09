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

    const ctx = await loadGenerationContext({ ...input, startDate: input.startDate || undefined });
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
      request: { count: input.count, postTypes: input.postTypes, productIds: input.productIds, startDate: input.startDate },
      response: { planning_notes: out.planning_notes, post_count: rows.length },
      usage: out.usage as object,
      created_by: owner.id,
    });
    await audit("ai.posts_generated", { actorId: owner.id, entity: "generation", entityId: batchId, details: { count: rows.length } });
    revalidatePath("/", "layout");
    return { ok: true, message: `${rows.length} nye forslag venter på din godkjenning. ${out.planning_notes}`, data: { batchId, count: rows.length } };
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
