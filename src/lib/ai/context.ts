import "server-only";
import { createClient } from "../supabase/server";
import { getProducts, getSettings } from "../data";
import { nextSlots, osloParts, addDays, WEEKDAYS_NB, osloToUtc } from "../dates";
import { upcomingSeasonalEvents } from "../calendar/seasons";
import type { GenerationContext } from "./prompts";

/** Bygger konteksten Claude får: innstillinger, produktbibliotek, historikk og tidspunkter. */
export async function loadGenerationContext(input: { count: number; startDate?: string; postTypes?: string[]; productIds?: string[]; instructions?: string }): Promise<GenerationContext> {
  const supabase = await createClient();
  const [settings, products, imagesRes, recentRes] = await Promise.all([
    getSettings(),
    getProducts({ activeOnly: true }),
    supabase.from("product_images").select("id, product_id, image_type, alt_text"),
    supabase
      .from("posts")
      .select("title, content, post_type, status, published_at, created_at")
      .not("status", "eq", "REJECTED")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const now = new Date();
  const from = input.startDate ? osloToUtc(addDays(input.startDate, -1), "23:59") : now;
  const days = settings.preferred_days.length ? settings.preferred_days : [1, 3, 5];
  const times = settings.preferred_times.length ? settings.preferred_times : ["19:00"];
  // Ett innlegg per dag: velg første foretrukne klokkeslett per dag.
  const slotsRaw = nextSlots(from, days, [times[0]!], input.count);
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
    recentPosts: (recentRes.data ?? []) as GenerationContext["recentPosts"],
    slots,
    seasonalEvents: seasonal.map((s) => ({ name: s.name, date: s.date, angle: s.angle })),
    focus: { postTypes: input.postTypes, productIds: input.productIds, instructions: input.instructions },
    now,
  };
}
