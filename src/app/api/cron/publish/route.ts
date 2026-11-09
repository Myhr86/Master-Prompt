import { NextResponse } from "next/server";
import { checkCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishPost } from "@/lib/posts/publisher";
import { supabasePublishStore } from "@/lib/posts/supabase-store";
import { graphClient } from "@/lib/facebook/connection";
import { effectivePublishMode } from "@/lib/posts/mode";
import { audit } from "@/lib/audit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Publiserer innlegg som eieren selv har GODKJENT og PLANLAGT.
 * Dette er ikke automatisk publisering av AI-innhold: kun status SCHEDULED
 * (som krever gyldig godkjenning) plukkes opp, og publishPost() kontrollerer
 * godkjenning og innholdshash på nytt – det gjør også databasen.
 */
export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;
  try {
    return await run();
  } catch (err) {
    log.error("cron.publish.failed", { error: err });
    return NextResponse.json({ error: `Publiseringsjobben feilet: ${(err as Error).message ?? "ukjent feil"}` }, { status: 500 });
  }
}

async function run() {
  const admin = createAdminClient();
  const { data: settings, error: settingsError } = await admin.from("business_settings").select("test_mode").eq("id", 1).single();
  if (settingsError) throw new Error(`Supabase: ${settingsError.message}`);
  const mode = effectivePublishMode(settings?.test_mode ?? true);
  const now = new Date().toISOString();

  const [{ data: due }, { data: stuck }] = await Promise.all([
    admin.from("posts").select("id").eq("status", "SCHEDULED").lte("scheduled_at", now).order("scheduled_at").limit(10),
    admin.from("posts").select("id").eq("status", "PUBLISHING").limit(10),
  ]);

  const store = supabasePublishStore(admin);
  const graph = graphClient();
  const results: { id: string; ok: boolean; reason?: string }[] = [];

  // Avklar uavklarte forsøk (kontrollerer Facebook før nytt forsøk) – ingen nye publiseringer herfra.
  for (const p of stuck ?? []) {
    if ((due ?? []).some((d) => d.id === p.id)) continue;
    const r = await publishPost(p.id, { store, graph, mode });
    results.push({ id: p.id, ok: r.ok, reason: r.ok ? undefined : r.reason });
  }

  for (const p of due ?? []) {
    // I testmodus beholdes status (simulert) – ikke kjør simuleringen om og om igjen.
    if (mode === "simulated") {
      const { data: last } = await admin.from("publish_attempts").select("id").eq("post_id", p.id).eq("mode", "simulated").eq("state", "succeeded").limit(1);
      if (last?.length) continue;
    }
    const r = await publishPost(p.id, { store, graph, mode });
    results.push({ id: p.id, ok: r.ok, reason: r.ok ? undefined : r.reason });
    await audit(r.ok ? (r.ok && r.simulated ? "cron.publish_simulated" : "cron.published") : "cron.publish_failed", {
      actorType: "cron",
      entity: "post",
      entityId: p.id,
      details: r.ok ? { mode } : { reason: r.reason, mode },
    });
  }
  log.info("cron.publish.done", { count: results.length, mode });
  return NextResponse.json({ mode, processed: results.length, results });
}
