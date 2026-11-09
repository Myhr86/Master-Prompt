import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { classifyPostTypes } from "../ai/classify";
import { callClaudeStructured } from "../ai/claude";
import { integrations } from "../env";
import { computeBestTimes, type BestTimes } from "./timing";
import { computeMix, type ContentMix, type MixItem } from "./mix";
import { log } from "../logger";

export interface PagePostRow {
  facebook_post_id: string;
  message: string;
  created_time: string;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  post_type: string | null;
}

const engagementOf = (p: Pick<PagePostRow, "reactions" | "comments" | "shares">) =>
  p.reactions === null && p.comments === null ? null : (p.reactions ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);

/** Sidens innlegg siste N dager, med innleggstype fra appen der den finnes. */
export async function loadPagePosts(db: SupabaseClient, days = 180): Promise<PagePostRow[] | null> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data, error } = await db
    .from("facebook_page_posts")
    .select("facebook_post_id, message, created_time, reactions, comments, shares, post_type")
    .gte("created_time", since)
    .order("created_time", { ascending: false })
    .limit(500);
  if (error) return null; // tabell/kolonner mangler (migrasjon 4/7)
  const { data: app } = await db.from("posts").select("facebook_post_id, post_type").not("facebook_post_id", "is", null);
  const appType = new Map((app ?? []).map((a) => [a.facebook_post_id as string, a.post_type as string | null]));
  return (data as PagePostRow[]).map((p) => ({ ...p, post_type: appType.get(p.facebook_post_id) ?? p.post_type }));
}

export function bestTimesFrom(rows: PagePostRow[]): BestTimes {
  return computeBestTimes(
    rows.map((r) => ({ created_time: r.created_time, engagement: engagementOf(r) ?? NaN })).filter((r) => Number.isFinite(r.engagement)),
  );
}

/**
 * Miks siste `days` dager: publiserte innlegg på siden + innlegg i appen som
 * venter, er godkjent eller planlagt (så planlagte innlegg teller med).
 */
export async function contentMix(db: SupabaseClient, days = 30): Promise<ContentMix> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [page, { data: upcoming }] = await Promise.all([
    loadPagePosts(db, days),
    db.from("posts").select("post_type").in("status", ["PENDING_APPROVAL", "APPROVED", "SCHEDULED"]).gte("scheduled_at", since),
  ]);
  const items: MixItem[] = [
    ...(page ?? []).map((p) => ({ post_type: p.post_type, engagement: engagementOf(p) })),
    ...(upcoming ?? []).map((p) => ({ post_type: p.post_type as string | null })),
  ];
  return computeMix(items);
}

/** Engasjement per gruppe over lengre tid (hva fungerer best). */
export function engagementMix(rows: PagePostRow[]): ContentMix {
  return computeMix(rows.map((r) => ({ post_type: r.post_type, engagement: engagementOf(r) })));
}

/**
 * Lar Claude anslå innleggstype for innlegg publisert utenom appen.
 * Skriver med service-rollen (tabellen kan bare leses av eier).
 */
export async function classifyUnclassifiedPagePosts(limit = 50): Promise<{ classified: number; remaining: number }> {
  if (!integrations().anthropic) return { classified: 0, remaining: 0 };
  const admin = createAdminClient();
  const { data: app } = await admin.from("posts").select("facebook_post_id").not("facebook_post_id", "is", null);
  const appIds = new Set((app ?? []).map((a) => a.facebook_post_id as string));
  const { data, error } = await admin
    .from("facebook_page_posts")
    .select("facebook_post_id, message")
    .is("post_type", null)
    .neq("message", "")
    .order("created_time", { ascending: false })
    .limit(300);
  if (error) return { classified: 0, remaining: 0 };
  const todo = (data ?? []).filter((r) => !appIds.has(r.facebook_post_id));
  const batch = todo.slice(0, limit);
  if (!batch.length) return { classified: 0, remaining: 0 };
  const { data: settings } = await admin.from("business_settings").select("ai_model").eq("id", 1).single();
  const types = await classifyPostTypes(batch.map((b) => ({ id: b.facebook_post_id, text: b.message })), callClaudeStructured, settings?.ai_model);
  let classified = 0;
  for (const [id, type] of types) {
    const { error: e } = await admin.from("facebook_page_posts").update({ post_type: type, classified_at: new Date().toISOString() }).eq("facebook_post_id", id);
    if (!e) classified++;
    else log.warn("classify.update_failed", { error: e.message });
  }
  return { classified, remaining: todo.length - classified };
}
