"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { collectAnalytics } from "@/lib/analytics/collect";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";
import { callClaudeStructured } from "@/lib/ai/claude";
import { MARKETING_SYSTEM_PROMPT, buildAnalysisPrompt } from "@/lib/ai/prompts";
import { AnalysisResultSchema, type AnalysisResult } from "@/lib/ai/schemas";
import { getSettings } from "@/lib/data";
import { latestMetricsByPost } from "@/lib/analytics/summary";
import { audit } from "@/lib/audit";

export async function refreshAnalytics(): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`insights:${owner.id}`, 10, 3600);
    const r = await collectAnalytics(await createClient());
    revalidatePath("/analyse");
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return toActionError(err, "refreshAnalytics");
  }
}

export async function analyzeWithClaude(): Promise<ActionResult<AnalysisResult>> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`ai:${owner.id}`, 20, 3600);
    const supabase = await createClient();
    const settings = await getSettings();
    const [{ data: posts }, { data: metrics }, { data: products }] = await Promise.all([
      supabase.from("posts").select("id, title, content, post_type, product_id, published_at").eq("status", "PUBLISHED").order("published_at", { ascending: false }).limit(60),
      supabase.from("analytics").select("post_id, metric_name, metric_value, recorded_at").order("recorded_at", { ascending: false }).limit(5000),
      supabase.from("products").select("id, name"),
    ]);
    const latest = latestMetricsByPost(metrics ?? []);
    const data = (posts ?? [])
      .filter((p) => latest.has(p.id))
      .map((p) => ({
        type: p.post_type,
        produkt: products?.find((x) => x.id === p.product_id)?.name ?? null,
        publisert: p.published_at,
        overskrift: p.title,
        utdrag: p.content.slice(0, 200),
        metrikker: latest.get(p.id),
      }));
    if (data.length < 3) throw new UserFacingError("Det trengs statistikk for minst tre publiserte innlegg før en analyse gir mening.");
    const res = await callClaudeStructured({ system: MARKETING_SYSTEM_PROMPT, user: buildAnalysisPrompt(data), schema: AnalysisResultSchema, model: settings.ai_model, effort: "high", maxTokens: 12000 });
    await supabase.from("ai_generations").insert({ kind: "analysis", model: res.model, status: "succeeded", response: res.data, usage: res.usage as object, created_by: owner.id });
    await audit("ai.analysis", { actorId: owner.id });
    return { ok: true, data: res.data };
  } catch (err) {
    return toActionError(err, "analyzeWithClaude");
  }
}
