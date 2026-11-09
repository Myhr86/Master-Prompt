"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { parseHashtags } from "@/lib/posts/validation";
import { seasonalEventsForYear } from "@/lib/calendar/seasons";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Klokkeslett må ha formen TT:MM");

const schema = z.object({
  business_name: z.string().trim().min(1).max(200),
  website: z.string().trim().url().refine((u) => u.startsWith("https://"), "Nettadressen må starte med https://"),
  brand_voice: z.string().trim().min(10, "Beskriv skrivestilen litt mer").max(4000),
  posting_frequency: z.coerce.number().int().min(1).max(14),
  preferred_days: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Velg minst én dag"),
  preferred_times: z.array(time).min(1).max(4),
  default_hashtags: z.array(z.string()).max(15),
  prioritized_product_ids: z.array(z.string().uuid()).max(30),
  weekly_plan: z.array(z.object({ day: z.number().int().min(1).max(7), theme: z.string().trim().min(1).max(80) })).max(7),
  seasonal_campaigns: z.array(z.object({ key: z.string(), name: z.string(), enabled: z.boolean() })),
  ai_model: z.string().trim().regex(/^claude-[a-z0-9-]+$/, "Ugyldig modell-ID"),
  image_provider: z.enum(["openai", "none"]),
  test_mode: z.boolean(),
});

export async function saveSettings(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const days = fd.getAll("preferred_days").map(String);
    const plan = [1, 2, 3, 4, 5, 6, 7]
      .map((d) => ({ day: d, theme: String(fd.get(`theme_${d}`) ?? "").trim() }))
      .filter((p) => p.theme);
    const seasonal = seasonalEventsForYear(new Date().getFullYear()).map((e) => ({ key: e.key, name: e.name, enabled: fd.get(`season_${e.key}`) === "on" }));
    const data = schema.parse({
      business_name: fd.get("business_name"),
      website: fd.get("website"),
      brand_voice: fd.get("brand_voice"),
      posting_frequency: fd.get("posting_frequency"),
      preferred_days: days,
      preferred_times: String(fd.get("preferred_times") ?? "")
        .split(/[,\s]+/)
        .filter(Boolean),
      default_hashtags: parseHashtags(String(fd.get("default_hashtags") ?? "")),
      prioritized_product_ids: fd.getAll("prioritized_product_ids").map(String),
      weekly_plan: plan,
      seasonal_campaigns: seasonal,
      ai_model: fd.get("ai_model"),
      image_provider: fd.get("image_provider"),
      test_mode: fd.get("test_mode") === "on",
    });
    const supabase = await createClient();
    const { error } = await supabase.from("business_settings").update(data).eq("id", 1);
    if (error) throw error;
    await audit("settings.updated", { actorId: owner.id, details: { test_mode: data.test_mode, ai_model: data.ai_model, image_provider: data.image_provider } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Innstillingene er lagret." };
  } catch (err) {
    return toActionError(err, "saveSettings");
  }
}
