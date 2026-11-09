import { createHash } from "node:crypto";

/**
 * Kanonisk hash av alt som blir synlig på Facebook.
 * MÅ være identisk med SQL-funksjonen public.post_content_hash()
 * (paritet verifiseres i tests/db/database.test.ts).
 */
export interface HashableContent {
  title: string | null;
  content: string | null;
  hashtags: string[] | null;
  link_url: string | null;
  image_path: string | null;
}

export function postContentHash(p: HashableContent): string {
  const sep = String.fromCharCode(31);
  const canonical = [
    p.title ?? "",
    p.content ?? "",
    (p.hashtags ?? []).join(" "),
    p.link_url ?? "",
    p.image_path ?? "",
  ].join(sep);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Teksten som faktisk sendes til Facebook. */
export function composeFacebookMessage(p: Pick<HashableContent, "title" | "content" | "hashtags">): string {
  const parts: string[] = [];
  const title = p.title?.trim();
  const body = p.content?.trim();
  if (title && !(body ?? "").startsWith(title)) parts.push(title);
  if (body) parts.push(body);
  const tags = (p.hashtags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length) parts.push(tags.join(" "));
  return parts.join("\n\n");
}
