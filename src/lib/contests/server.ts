import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReminderFooter, buildRulesText, contestCompliance, META_DISCLAIMER, type ContestInput } from "./rules";

/**
 * Sørger for at et konkurranseinnlegg fortsatt har vilkår etter redigering
 * eller ny AI-tekst, og returnerer merknader fra regelkontrollen.
 */
export async function enforceContestText(
  supabase: SupabaseClient,
  post: { contest_id: string | null; contest_role: string | null },
  text: { title: string; content: string },
  businessName: string,
): Promise<{ content: string; warnings: string[] } | null> {
  if (!post.contest_id || !post.contest_role) return null;
  const { data: c } = await supabase.from("contests").select("*").eq("id", post.contest_id).maybeSingle();
  if (!c) return null;
  const input: ContestInput = { ...c, business_name: businessName };
  let content = text.content.trim();
  if (post.contest_role === "kunngjoring" && !content.includes(META_DISCLAIMER)) content = `${content}\n\n${buildRulesText(input)}`;
  if (post.contest_role === "paminnelse" && !content.includes(META_DISCLAIMER)) content = `${content}\n\n${buildReminderFooter(input)}`;
  let warnings = contestCompliance(`${text.title}\n${content}`);
  if (post.contest_role === "vinner") warnings = warnings.filter((w) => !w.includes("erklæringen"));
  return { content, warnings };
}
