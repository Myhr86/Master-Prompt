"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { audit } from "@/lib/audit";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";
import { getSettings } from "@/lib/data";
import { integrations } from "@/lib/env";
import { callClaudeStructured } from "@/lib/ai/claude";
import { analyzePage } from "@/lib/review/analyze";
import { collectPageSnapshot } from "@/lib/review/collect";
import { uuidSchema } from "@/lib/posts/validation";

export async function runPageReview(): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    if (!integrations().anthropic) throw new UserFacingError("Claude er ikke konfigurert (ANTHROPIC_API_KEY).");
    await enforceRateLimit(`page-review:${owner.id}`, 6, 24 * 3600);
    const supabase = await createClient();
    const settings = await getSettings();
    const { snapshot, images } = await collectPageSnapshot(supabase);
    const { review, model } = await analyzePage(snapshot, images, callClaudeStructured, settings.ai_model);
    const { error } = await supabase.from("page_reviews").insert({ snapshot, result: review, model, created_by: owner.id });
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new UserFacingError("Databasen mangler oppdateringen for sidegjennomgang. Kjør supabase/migrations/20261109000010_page_reviews.sql i Supabase → SQL Editor.");
      throw error;
    }
    await supabase.from("ai_generations").insert({ kind: "analysis", model, status: "succeeded", request: { purpose: "page_review", images: images.length }, created_by: owner.id });
    await audit("page.reviewed", { actorId: owner.id });
    revalidatePath("/sidegjennomgang");
    return { ok: true, message: "Gjennomgangen er klar." };
  } catch (err) {
    return toActionError(err, "runPageReview");
  }
}

/** Marker et forbedringspunkt som gjort / ikke gjort. */
export async function toggleReviewItem(reviewId: string, index: number, done: boolean): Promise<ActionResult> {
  try {
    await requireOwner();
    uuidSchema.parse(reviewId);
    const i = z.number().int().min(0).max(100).parse(index);
    const supabase = await createClient();
    const { data, error } = await supabase.from("page_reviews").select("result").eq("id", reviewId).single();
    if (error) throw error;
    const result = data.result as { items: { done?: boolean }[] };
    if (!result.items[i]) throw new UserFacingError("Fant ikke punktet.");
    result.items[i]!.done = done;
    const { error: uErr } = await supabase.from("page_reviews").update({ result }).eq("id", reviewId);
    if (uErr) throw uErr;
    revalidatePath("/sidegjennomgang");
    return { ok: true };
  } catch (err) {
    return toActionError(err, "toggleReviewItem");
  }
}
