import "server-only";
import { createClient } from "./supabase/server";
import type { BusinessSettings, FacebookStatus, Post, Product } from "./types";

export async function getSettings(): Promise<BusinessSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("business_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data as BusinessSettings;
}

export async function getFacebookStatus(): Promise<FacebookStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_facebook_status");
  const row = Array.isArray(data) ? data[0] : data;
  return (row as FacebookStatus | undefined) ?? null;
}

export async function getProducts(opts: { activeOnly?: boolean } = {}): Promise<Product[]> {
  const supabase = await createClient();
  let q = supabase.from("products").select("*").order("name");
  if (opts.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function getPost(id: string): Promise<Post | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("posts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Post | null) ?? null;
}

/** Antall hentede innlegg fra Facebook-siden. null = tabellen finnes ikke (migrasjon 4 mangler). */
export async function getPagePostStats(): Promise<{ count: number; lastImported: string | null } | null> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("facebook_page_posts").select("id", { count: "exact", head: true });
  if (error) return null;
  const { data } = await supabase.from("facebook_page_posts").select("imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle();
  return { count: count ?? 0, lastImported: data?.imported_at ?? null };
}
