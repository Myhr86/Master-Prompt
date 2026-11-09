import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "../supabase/server";
import { MEDIA_BUCKET } from "../supabase/admin";

/** Laster opp til den private bøtta via eierens sesjon (RLS på storage.objects). */
export async function uploadMedia(data: Buffer, mimeType: string, folder: "products" | "uploads" | "generated" | "composites" | "graphics"): Promise<string> {
  const supabase = await createClient();
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const now = new Date();
  const path = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, data, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Opplasting feilet: ${error.message}`);
  return path;
}

export async function downloadMedia(path: string): Promise<Buffer> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) throw new Error("Fant ikke bildet i lagringen");
  return Buffer.from(await data.arrayBuffer());
}

export async function removeMedia(paths: string[]) {
  if (!paths.length) return;
  const supabase = await createClient();
  await supabase.storage.from(MEDIA_BUCKET).remove(paths);
}

/** Kortlevde signerte URL-er for visning i grensesnittet. */
export async function signedUrls(paths: (string | null | undefined)[], expiresIn = 60 * 60): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!unique.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(unique, expiresIn);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}
