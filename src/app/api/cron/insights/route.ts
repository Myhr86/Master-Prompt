import { NextResponse } from "next/server";
import { checkCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectAnalytics } from "@/lib/analytics/collect";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;
  try {
    const result = await collectAnalytics(createAdminClient());
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (err) {
    return NextResponse.json({ error: `Statistikkjobben feilet: ${(err as Error).message ?? "ukjent feil"}` }, { status: 500 });
  }
}
