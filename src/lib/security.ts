import "server-only";
import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { env } from "./env";
import { log } from "./logger";

export class RateLimitError extends Error {
  constructor() {
    super("For mange forespørsler. Vent litt og prøv igjen.");
    this.name = "RateLimitError";
  }
}

/** Database-basert rate limiting – fungerer på tvers av serverløse instanser. */
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, useAdmin = false) {
  const supabase = useAdmin ? createAdminClient() : await createClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    log.error("rate_limit.error", { key, error: error.message });
    throw new Error("Kunne ikke kontrollere forespørselsgrense");
  }
  if (data !== true) throw new RateLimitError();
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "ukjent";
}

/**
 * CSRF-beskyttelse for API-ruter som endrer tilstand. (Server Actions har
 * innebygd Origin-kontroll i Next.js.)
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new URL(env().APP_URL).origin;
  if (!origin || origin !== allowed) {
    throw new Error("Ugyldig opprinnelse for forespørselen");
  }
}
