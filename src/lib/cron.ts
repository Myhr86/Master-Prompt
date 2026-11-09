import "server-only";
import { NextResponse } from "next/server";
import { configProblems } from "./env";
import { safeEqual } from "./crypto";

/**
 * Autoriserer cron-kall ("Authorization: Bearer <CRON_SECRET>").
 * Leser CRON_SECRET direkte, slik at en feil i ANDRE miljøvariabler kan
 * rapporteres (med navn, aldri verdier) til den som har riktig hemmelighet.
 * Returnerer et svar ved feil, ellers null.
 */
export function checkCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) {
    return NextResponse.json({ error: "Serveren mangler gyldig CRON_SECRET (minst 32 tegn) i miljøvariablene." }, { status: 500 });
  }
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!(header.length === expected.length && safeEqual(header, expected))) {
    return NextResponse.json({ error: "Ikke autorisert" }, { status: 401 });
  }
  const missing = configProblems();
  if (missing.length) {
    return NextResponse.json({ error: "Miljøvariabler mangler eller er ugyldige i Vercel", missing }, { status: 500 });
  }
  return null;
}
