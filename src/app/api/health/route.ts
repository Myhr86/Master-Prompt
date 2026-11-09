import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Enkel helsesjekk uten sensitive opplysninger. */
export function GET() {
  return NextResponse.json({ ok: true });
}
