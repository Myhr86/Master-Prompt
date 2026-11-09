import "server-only";
import { createClient } from "../supabase/server";
import { getProducts, getSettings } from "../data";
import { nextFreeSlots, nextSlots, osloParts, addDays, WEEKDAYS_NB, osloToUtc } from "../dates";
import { upcomingSeasonalEvents } from "../calendar/seasons";
import type { GenerationContext } from "./prompts";
import { contentMix } from "../analytics/page-insights";
import { mixSummaryForPrompt } from "../analytics/mix";

/** Bygger konteksten Claude får: innstillinger, produktbibliotek, historikk og tidspunkter. */
export async function loadGenerationContext(input: {
  count: number;
  startDate?: string;
  postTypes?: string[];
  productIds?: string[];
  instructions?: string;
  /** Legg forslaget på neste dag som ikke allerede har et innlegg. */
  skipBusyDays?: boolean;
}): Promise<GenerationContext> {
  const supabase = await createClient();
  const [settings, products, imagesRes, recentRes, fbRes, mediaRes] = await Promise.all([
    getSettings(),
    getProducts({ activeOnly: true }),
    supabase.from("product_images").select("id, product_id, image_type, alt_text"),
    supabase
      .from("posts")
      .select("title, content, post_type, status, published_at, created_at, facebook_post_id")
      .not("status", "eq", "REJECTED")
      .order("created_at", { ascending: false })
      .limit(40),
    // Innlegg som allerede ligger på Facebook-siden (også publisert utenom appen).
    supabase.from("facebook_page_posts").select("facebook_post_id, message, created_time, has_image").order("created_time", { ascending: false }).limit(60),
    // Mediebanken: kun tekstbeskrivelser av ferdig analyserte bilder (billig).
    supabase
      .from("media_assets")
      .select("id, category, description, tags, product_id, people_visible, last_used_at, use_count")
      .eq("in_library", true)
      .eq("analysis_status", "done")
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(150),
  ]);
  const appPosts = (recentRes.data ?? []) as (GenerationContext["recentPosts"][number] & { facebook_post_id: string | null })[];
  const appFbIds = new Set(appPosts.map((p) => p.facebook_post_id).filter(Boolean));
  const fbPosts: GenerationContext["recentPosts"] = (fbRes.error ? [] : fbRes.data ?? [])
    .filter((f) => !appFbIds.has(f.facebook_post_id) && f.message.trim())
    .map((f) => ({ title: "", content: f.message, post_type: null, status: "PUBLISHED", published_at: f.created_time, created_at: f.created_time, source: "facebook" as const, has_image: f.has_image }));
  // Én samlet tidslinje, nyeste først.
  const recentPosts = [...appPosts.map((p) => ({ title: p.title, content: p.content, post_type: p.post_type, status: p.status, published_at: p.published_at, created_at: p.created_at, source: "app" as const })), ...fbPosts]
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at))
    .slice(0, 80);
  const now = new Date();
  const from = input.startDate ? osloToUtc(addDays(input.startDate, -1), "23:59") : now;
  const days = settings.preferred_days.length ? settings.preferred_days : [1, 3, 5];
  const times = settings.preferred_times.length ? settings.preferred_times : ["19:00"];
  // Ett innlegg per dag: velg første foretrukne klokkeslett per dag.
  let slotsRaw = nextSlots(from, days, [times[0]!], input.count);
  if (input.skipBusyDays) {
    const { data: upcoming } = await supabase
      .from("posts")
      .select("scheduled_at")
      .not("status", "eq", "REJECTED")
      .gte("scheduled_at", now.toISOString());
    const busy = new Set((upcoming ?? []).filter((r) => r.scheduled_at).map((r) => osloParts(new Date(r.scheduled_at!)).dateKey));
    slotsRaw = nextFreeSlots(from, days, times[0]!, input.count, busy);
  }
  const slots = slotsRaw.map((d) => {
    const p = osloParts(d);
    return {
      iso: d.toISOString(),
      weekday: WEEKDAYS_NB[p.isoWeekday - 1]!,
      theme: settings.weekly_plan.find((w) => w.day === p.isoWeekday)?.theme ?? null,
    };
  });
  const startKey = osloParts(from).dateKey;
  const disabledSeasonal = new Set(settings.seasonal_campaigns.filter((c) => c.enabled === false).map((c) => c.key));
  const seasonal = upcomingSeasonalEvents(startKey, addDays(startKey, 30)).filter((e) => !disabledSeasonal.has(e.key));
  return {
    settings,
    products,
    productImages: (imagesRes.data ?? []) as GenerationContext["productImages"],
    recentPosts,
    contentMix: await contentMix(supabase, 30)
      .then((m) => mixSummaryForPrompt(m, 30))
      .catch(() => ""),
    mediaLibrary: mediaRes.error ? [] : ((mediaRes.data ?? []) as NonNullable<GenerationContext["mediaLibrary"]>),
    slots,
    seasonalEvents: seasonal.map((s) => ({ name: s.name, date: s.date, angle: s.angle })),
    focus: { postTypes: input.postTypes, productIds: input.productIds, instructions: input.instructions },
    now,
  };
}
