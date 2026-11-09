import { NextResponse } from "next/server";
import { checkCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectAnalytics } from "@/lib/analytics/collect";
import { syncPagePosts } from "@/lib/facebook/sync";
import { classifyUnclassifiedPagePosts } from "@/lib/analytics/page-insights";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;
  try {
    // Oppdater kopien av sidens innlegg (også de publisert utenom appen) for AI-ens historikk.
    const sync = await syncPagePosts().catch((e: Error) => ({ ok: false, message: e.message }));
    // Anslå innleggstype for nye innlegg publisert utenom appen (for «balanse i innholdet»).
    const classified = await classifyUnclassifiedPagePosts(50).catch(() => ({ classified: 0, remaining: 0 }));
    const result = await collectAnalytics(createAdminClient());
    return NextResponse.json({ ...result, pagePosts: sync.message, classified: classified.classified }, { status: result.ok ? 200 : 503 });
  } catch (err) {
    return NextResponse.json({ error: `Statistikkjobben feilet: ${(err as Error).message ?? "ukjent feil"}` }, { status: 500 });
  }
}
