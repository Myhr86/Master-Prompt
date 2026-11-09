import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectionSecret, graphClient } from "../facebook/connection";
import { fetchImage } from "../products/image-fetch";
import { prepareForVision } from "../media/analyze";
import { bestTimesFrom, contentMix, loadPagePosts } from "../analytics/page-insights";
import { UserFacingError } from "../action-result";

/**
 * Samler data til sidegjennomgangen. Øyeblikksbildet lagres – det inneholder
 * ALDRI tokens. Profil- og coverbilde sendes til Claude, men lagres ikke.
 */
export async function collectPageSnapshot(db: SupabaseClient) {
  const graph = graphClient();
  if (!graph) throw new UserFacingError("Meta-appen er ikke konfigurert.");
  const conn = await getConnectionSecret();
  if (!conn || conn.status !== "connected") throw new UserFacingError("Facebook er ikke tilkoblet. Koble til under Innstillinger.");

  const [{ data: profile, unavailable }, cta, pagePosts, mix, settingsRes, productsRes, mediaRes, utmRes] = await Promise.all([
    graph.getPageProfile(conn.pageId, conn.token),
    graph.getCallToActions(conn.pageId, conn.token),
    loadPagePosts(db, 90),
    contentMix(db, 30),
    db.from("business_settings").select("business_name, website").eq("id", 1).single(),
    db.from("products").select("id", { count: "exact", head: true }).eq("active", true),
    db.from("media_assets").select("id", { count: "exact", head: true }).eq("in_library", true),
    db.from("business_settings").select("utm_enabled").eq("id", 1).maybeSingle(),
  ]);

  const posts = pagePosts ?? [];
  const now = Date.now();
  const within = (days: number) => posts.filter((p) => now - new Date(p.created_time).getTime() <= days * 864e5);
  const eng = posts.map((p) => (p.reactions === null && p.comments === null && p.shares === null ? null : (p.reactions ?? 0) + (p.comments ?? 0) + (p.shares ?? 0))).filter((x): x is number => x !== null);
  const bt = bestTimesFrom(posts);
  const cover = (profile.cover as { source?: string } | undefined)?.source ?? null;
  const picture = ((profile.picture as { data?: { url?: string; is_silhouette?: boolean } } | undefined)?.data) ?? null;

  const snapshot = {
    hentet: new Date().toISOString(),
    side: {
      navn: profile.name ?? null,
      brukernavn: profile.username ?? null,
      lenke: profile.link ?? null,
      kategori: profile.category ?? null,
      intro_about: profile.about ?? null,
      beskrivelse: profile.description ?? null,
      nettside: profile.website ?? null,
      telefon_oppgitt: "phone" in profile ? Boolean(profile.phone) : null,
      epost_oppgitt: "emails" in profile ? Boolean((profile.emails as unknown[] | undefined)?.length) : null,
      adresse: profile.single_line_address ?? null,
      apningstider_oppgitt: "hours" in profile ? Boolean(profile.hours && Object.keys(profile.hours as object).length) : null,
      folgere: profile.followers_count ?? null,
      liker_siden: profile.fan_count ?? null,
      vurdering: profile.overall_star_rating ?? null,
      antall_vurderinger: profile.rating_count ?? null,
      har_coverbilde: "cover" in profile ? Boolean(cover) : null,
      har_profilbilde: picture ? !picture.is_silhouette : null,
      handlingsknapp: cta === null ? "ikke_tilgjengelig" : cta.length ? cta.map((c) => ({ type: c.type, status: c.status, lenke: c.web_url ?? null })) : "ingen",
    },
    ikke_tilgjengelig: unavailable,
    innlegg: {
      siste_30_dager: within(30).length,
      siste_90_dager: posts.length,
      per_uke_snitt_90d: Math.round((posts.length / (90 / 7)) * 10) / 10,
      sist_publisert: posts[0]?.created_time ?? null,
      andel_med_bilde: null as number | null,
      engasjement_tilgjengelig: eng.length > 0,
      snitt_engasjement: eng.length ? Math.round((eng.reduce((a, b) => a + b, 0) / eng.length) * 10) / 10 : null,
      beste_tidspunkt: bt.recommendation,
      innholdsmiks_30d: mix.total >= 3 ? mix.pillars.map((p) => ({ gruppe: p.label, andel: Math.round(p.share * 100) })) : "for lite data",
    },
    appen: {
      nettbutikk: settingsRes.data?.website ?? null,
      aktive_produkter_i_biblioteket: productsRes.count ?? 0,
      filer_i_mediebanken: mediaRes.count ?? 0,
      sporing_av_trafikk_paa: utmRes.data?.utm_enabled ?? true,
    },
  };
  const { data: imgRows } = await db.from("facebook_page_posts").select("has_image").gte("created_time", new Date(now - 90 * 864e5).toISOString());
  if (imgRows?.length) snapshot.innlegg.andel_med_bilde = Math.round((imgRows.filter((r) => r.has_image).length / imgRows.length) * 100);

  // Bilder til Claude (ikke lagret). Feil ignoreres – da vurderes de som «kunne ikke sjekkes».
  const images: { mediaType: "image/jpeg"; base64: string; label: string }[] = [];
  for (const [url, label] of [
    [picture && !picture.is_silhouette ? picture.url ?? null : null, "profilbilde"],
    [cover, "coverbilde"],
  ] as const) {
    if (!url) continue;
    try {
      images.push({ mediaType: "image/jpeg", base64: await prepareForVision(await fetchImage(url)), label });
    } catch {
      /* hopp over */
    }
  }
  return { snapshot, images };
}
