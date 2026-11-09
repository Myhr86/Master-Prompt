"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, clientIp, RateLimitError } from "@/lib/security";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Skriv inn en gyldig e-postadresse"),
  password: z.string().min(8, "Passordet er for kort").max(200),
});

export async function signIn(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const ip = await clientIp();
  try {
    await enforceRateLimit(`login:${ip}`, 10, 15 * 60, true);
    await enforceRateLimit(`login-email:${parsed.data.email}`, 10, 15 * 60, true);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: "For mange innloggingsforsøk. Vent 15 minutter og prøv igjen." };
    log.error("auth.rate_limit_unavailable", { error: err });
    return { error: "Innlogging er midlertidig utilgjengelig. Prøv igjen om litt." };
  }

  const generic = "Feil e-post eller passord.";
  if (!env().OWNER_EMAILS.includes(parsed.data.email)) {
    log.warn("auth.login_denied", { reason: "not_owner_email" });
    return { error: generic };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    log.warn("auth.login_failed", { ip });
    return { error: generic };
  }
  const { data: owner } = await supabase.from("users").select("id").eq("id", data.user.id).maybeSingle();
  if (!owner) {
    await supabase.auth.signOut();
    log.warn("auth.login_denied", { reason: "no_owner_row" });
    return { error: "Kontoen er ikke registrert som eier. Kjør scripts/create-owner.mjs (se README)." };
  }
  log.info("auth.login_ok", { userId: data.user.id });
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
