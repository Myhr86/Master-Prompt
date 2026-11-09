import type { SupabaseClient } from "@supabase/supabase-js";

/** Markerer mediebank-bilder som brukt, slik at Claude foretrekker bilder som ikke er brukt nylig. */
export async function markMediaUsed(supabase: SupabaseClient, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const { data } = await supabase.from("media_assets").select("id, use_count").in("id", unique);
  const now = new Date().toISOString();
  for (const r of data ?? []) {
    // Ignorer feil (f.eks. hvis migrasjon 5 ikke er kjørt) – dette er bare statistikk.
    await supabase.from("media_assets").update({ last_used_at: now, use_count: (r.use_count ?? 0) + 1 }).eq("id", r.id);
  }
}
