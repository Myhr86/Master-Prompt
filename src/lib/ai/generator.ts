import { MARKETING_SYSTEM_PROMPT, buildGenerationPrompt, buildRewritePrompt, type GenerationContext } from "./prompts";
import { GenerationResultSchema, RewriteResultSchema, type GenerationResult, type RewriteResult } from "./schemas";
import { composeBody, postcheck, type CheckedPost } from "./postcheck";
import type { StructuredCaller } from "./claude";
import type { BusinessSettings, Product } from "../types";
import { hashtagSchema } from "../posts/validation";

export interface GenerationOutput {
  posts: (CheckedPost & { content: string })[];
  planning_notes: string;
  model: string;
  usage: unknown;
}

/**
 * Lager innleggsforslag. Ren funksjon rundt Claude-kallet slik at den kan
 * testes uten nettverk. Resultatet lagres alltid som PENDING_APPROVAL.
 */
export async function generatePosts(ctx: GenerationContext, call: StructuredCaller): Promise<GenerationOutput> {
  if (ctx.slots.length === 0) throw new Error("Ingen publiseringstidspunkter å generere for");
  const res = await call({
    system: MARKETING_SYSTEM_PROMPT,
    user: buildGenerationPrompt(ctx),
    schema: GenerationResultSchema,
    model: ctx.settings.ai_model,
    effort: "high",
    maxTokens: 32000,
  });
  const result: GenerationResult = res.data;
  const productImageIds = new Set(ctx.productImages.map((i) => i.id));
  const checked = result.posts.slice(0, ctx.slots.length).map((p, i) => {
    const c = postcheck(p, i, {
      products: ctx.products,
      productImageIds,
      website: ctx.settings.website,
      recentTexts: ctx.recentPosts.map((r) => r.content),
      fallbackTimes: ctx.slots.map((s) => s.iso),
      now: ctx.now,
      defaultHashtags: ctx.settings.default_hashtags,
    });
    return { ...c, content: composeBody(c) };
  });
  return { posts: checked, planning_notes: result.planning_notes, model: res.model, usage: res.usage };
}

export async function rewritePost(
  input: { settings: BusinessSettings; product: Product | null; current: { title: string; content: string; hashtags: string[] }; instructions: string },
  call: StructuredCaller,
): Promise<RewriteResult & { content: string; model: string }> {
  const res = await call({
    system: MARKETING_SYSTEM_PROMPT,
    user: buildRewritePrompt(input),
    schema: RewriteResultSchema,
    model: input.settings.ai_model,
    effort: "medium",
    maxTokens: 8000,
  });
  const hashtags = res.data.hashtags
    .map((t) => hashtagSchema.safeParse(t))
    .filter((r) => r.success)
    .map((r) => r.data as string);
  return { ...res.data, hashtags: [...new Set(hashtags)].slice(0, 8), content: composeBody({ body: res.data.body, call_to_action: res.data.call_to_action }), model: res.model };
}
