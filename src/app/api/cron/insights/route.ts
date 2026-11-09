import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectAnalytics } from "@/lib/analytics/collect";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "Ikke autorisert" }, { status: 401 });
  const result = await collectAnalytics(createAdminClient());
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
