import "server-only";
import { createAdminClient } from "../supabase/admin";
import { getConnectionSecret, graphClient, setConnectionStatus } from "./connection";
import { GraphError } from "./graph";
import { log } from "../logger";

/**
 * Henter eksisterende innlegg fra Facebook-siden (også de som er publisert
 * direkte på Facebook) og lagrer en kopi, slik at AI-en kan unngå å gjenta seg.
 * Kun lesing – ingenting endres på Facebook.
 */
export async function syncPagePosts(max = 100): Promise<{ ok: boolean; message: string; count?: number }> {
  const graph = graphClient();
  if (!graph) return { ok: false, message: "Meta-appen er ikke konfigurert." };
  const conn = await getConnectionSecret();
  if (!conn || conn.status !== "connected") return { ok: false, message: "Facebook er ikke tilkoblet." };

  let posts;
  try {
    posts = await graph.listPublishedPosts(conn.pageId, conn.token, max);
  } catch (err) {
    if (err instanceof GraphError && err.needsReconnect) {
      await setConnectionStatus("expired", err.message);
      return { ok: false, message: "Facebook-tilgangen er utløpt. Koble til på nytt." };
    }
    if (err instanceof GraphError && err.kind === "permission") {
      return { ok: false, message: `Facebook ga ikke tilgang til å lese innleggene: ${err.message}` };
    }
    log.warn("facebook.sync_failed", { error: err });
    return { ok: false, message: `Kunne ikke hente innlegg fra Facebook${err instanceof GraphError ? `: ${err.message}` : "."}` };
  }

  const coverage = graph.engagementCoverage;
  const rows = posts.map((p) => ({
    page_id: conn.pageId,
    facebook_post_id: p.id,
    message: (p.message ?? "").slice(0, 10000),
    created_time: p.created_time,
    permalink_url: p.permalink_url ?? null,
    has_image: Boolean(p.full_picture),
    status_type: p.status_type ?? null,
    imported_at: new Date().toISOString(),
    reactions: p.reactions?.summary?.total_count ?? null,
    // Uten tilgang til kommentarer lagres null (ukjent), ikke 0.
    comments: coverage === "alle" ? p.comments?.summary?.total_count ?? null : null,
    shares: p.shares?.count ?? (p.reactions ? 0 : null),
    metrics_updated_at: p.reactions || p.comments ? new Date().toISOString() : null,
  }));
  if (rows.length) {
    const admin = createAdminClient();
    let { error } = await admin.from("facebook_page_posts").upsert(rows, { onConflict: "facebook_post_id" });
    if (error && (error.code === "PGRST204" || error.code === "42703")) {
      // Migrasjon 7 ikke kjørt: lagre uten engasjementstall.
      const basic = rows.map((r) => ({
        page_id: r.page_id,
        facebook_post_id: r.facebook_post_id,
        message: r.message,
        created_time: r.created_time,
        permalink_url: r.permalink_url,
        has_image: r.has_image,
        status_type: r.status_type,
        imported_at: r.imported_at,
      }));
      ({ error } = await admin.from("facebook_page_posts").upsert(basic, { onConflict: "facebook_post_id" }));
    }
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205" || /facebook_page_posts/.test(error.message)) {
        return { ok: false, message: "Databasen mangler tabellen for Facebook-innlegg. Kjør supabase/migrations/20261109000004_facebook_page_posts.sql i Supabase → SQL Editor." };
      }
      throw error;
    }
  }
  const note =
    coverage === "alle" ? "" : coverage === "uten_kommentarer" ? " Antall kommentarer er ikke tilgjengelig med dagens tillatelser – reaksjoner og delinger brukes." : " Engasjementstall er ikke tilgjengelige med dagens tillatelser.";
  return { ok: true, message: `Hentet ${rows.length} innlegg fra Facebook-siden.${note}`, count: rows.length };
}
