import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { graphClient, facebookRedirectUri } from "@/lib/facebook/connection";
import { writeOAuthCookie } from "@/lib/facebook/oauth-cookie";
import { randomToken } from "@/lib/crypto";
import { assertSameOrigin } from "@/lib/security";
import { env } from "@/lib/env";

/** Starter Facebook Login. POST (fra skjema) med Origin-kontroll mot CSRF. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 403 });
  }
  const owner = await getOwner();
  if (!owner) return NextResponse.redirect(new URL("/login", env().APP_URL), 303);
  const graph = graphClient();
  if (!graph) return NextResponse.redirect(new URL("/innstillinger?fb=ikke-konfigurert#facebook", env().APP_URL), 303);
  const state = randomToken(24);
  await writeOAuthCookie({ state });
  return NextResponse.redirect(graph.loginUrl(state, facebookRedirectUri()), 303);
}
