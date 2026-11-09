import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectionSecret, graphClient, setConnectionStatus } from "../facebook/connection";
import { GraphError } from "../facebook/graph";
import { env } from "../env";
import { log } from "../logger";

/**
 * Henter engasjement (reaksjoner, kommentarer, delinger) og eventuelle
 * innsiktsmetrikker for publiserte innlegg. Lagrer KUN verdier Facebook
 * faktisk returnerer – manglende data lagres ikke og vises som «ikke tilgjengelig».
 */
export async function collectAnalytics(db: SupabaseClient, opts: { days?: number; limit?: number } = {}) {
  const graph = graphClient();
  if (!graph) return { ok: false as const, message: "Meta-appen er ikke konfigurert." };
  const conn = await getConnectionSecret();
  if (!conn || conn.status !== "connected") return { ok: false as const, message: "Facebook er ikke tilkoblet." };

  const since = new Date(Date.now() - (opts.days ?? 90) * 864e5).toISOString();
  const { data: posts, error } = await db
    .from("posts")
    .select("id, facebook_post_id")
    .eq("status", "PUBLISHED")
    .not("facebook_post_id", "is", null)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw error;

  const metrics = env().META_INSIGHTS_METRICS.split(",").map((m) => m.trim()).filter(Boolean);
  let updated = 0;
  const unavailable = new Set<string>();
  for (const p of posts ?? []) {
    try {
      const values: Record<string, number> = await graph.getEngagement(p.facebook_post_id!, conn.token);
      if (metrics.length) {
        const ins = await graph.getInsights(p.facebook_post_id!, conn.token, metrics);
        Object.assign(values, ins.values);
        ins.unavailable.forEach((m) => unavailable.add(m));
      }
      const rows = Object.entries(values).map(([metric_name, metric_value]) => ({ post_id: p.id, metric_name, metric_value, source: "facebook" }));
      if (rows.length) {
        const { error: insErr } = await db.from("analytics").insert(rows);
        if (insErr) throw insErr;
        updated++;
      }
    } catch (err) {
      if (err instanceof GraphError && err.needsReconnect) {
        await setConnectionStatus("expired", err.message);
        return { ok: false as const, message: "Facebook-tilgangen er utløpt. Koble til på nytt." };
      }
      log.warn("analytics.post_failed", { postId: p.id, error: err });
    }
  }
  return {
    ok: true as const,
    message: `Statistikk oppdatert for ${updated} innlegg.${unavailable.size ? ` Ikke tilgjengelig fra Facebook: ${[...unavailable].join(", ")}.` : ""}`,
  };
}
