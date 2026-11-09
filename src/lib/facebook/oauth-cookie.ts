import "server-only";
import { cookies } from "next/headers";
import { decryptSecret, encryptSecret } from "../crypto";
import { env } from "../env";

/**
 * Midlertidig, kryptert og httpOnly informasjonskapsel som holder
 * OAuth-state og (etter innlogging) brukertokenet i maks 10 minutter mens
 * eieren velger side. Tokenet når aldri JavaScript i nettleseren.
 */
const NAME = "__Host-fb_oauth";

interface Payload {
  state: string;
  userToken?: string;
  userTokenExpiresAt?: string | null;
  scopes?: string[];
  exp: number;
}

export async function writeOAuthCookie(p: Omit<Payload, "exp">) {
  const jar = await cookies();
  const payload: Payload = { ...p, exp: Date.now() + 10 * 60_000 };
  jar.set(NAME, encryptSecret(JSON.stringify(payload), env().TOKEN_ENCRYPTION_KEY), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

export async function readOAuthCookie(): Promise<Payload | null> {
  const jar = await cookies();
  const raw = jar.get(NAME)?.value;
  if (!raw) return null;
  try {
    const p = JSON.parse(decryptSecret(raw, env().TOKEN_ENCRYPTION_KEY)) as Payload;
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export async function clearOAuthCookie() {
  const jar = await cookies();
  jar.delete(NAME);
}
