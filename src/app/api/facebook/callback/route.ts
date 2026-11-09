import { NextResponse, type NextRequest } from "next/server";
import { getOwner } from "@/lib/auth";
import { graphClient, facebookRedirectUri } from "@/lib/facebook/connection";
import { clearOAuthCookie, readOAuthCookie, writeOAuthCookie } from "@/lib/facebook/oauth-cookie";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { REQUIRED_SCOPES } from "@/lib/facebook/graph";

function back(path: string) {
  return NextResponse.redirect(new URL(path, env().APP_URL), 303);
}

export async function GET(request: NextRequest) {
  const owner = await getOwner();
  if (!owner) return back("/login");
  const graph = graphClient();
  if (!graph) return back("/innstillinger?fb=ikke-konfigurert#facebook");

  const params = request.nextUrl.searchParams;
  const cookie = await readOAuthCookie();
  const state = params.get("state") ?? "";
  if (!cookie || !state || !safeEqual(state, cookie.state)) {
    await clearOAuthCookie();
    log.warn("facebook.oauth_state_mismatch");
    return back("/innstillinger?fb=ugyldig-state#facebook");
  }
  if (params.get("error")) {
    await clearOAuthCookie();
    return back("/innstillinger?fb=avbrutt#facebook");
  }
  const code = params.get("code");
  if (!code) return back("/innstillinger?fb=avbrutt#facebook");

  try {
    const shortToken = await graph.exchangeCode(code, facebookRedirectUri());
    const long = await graph.exchangeLongLived(shortToken);
    const scopes = await graph.grantedPermissions(long.token);
    const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
    if (missing.length) {
      await clearOAuthCookie();
      await audit("facebook.missing_permissions", { actorId: owner.id, details: { missing } });
      return back(`/innstillinger?fb=mangler-tillatelser&mangler=${encodeURIComponent(missing.join(","))}#facebook`);
    }
    await writeOAuthCookie({ state: cookie.state, userToken: long.token, userTokenExpiresAt: long.expiresAt?.toISOString() ?? null, scopes });
    return back("/facebook/velg-side");
  } catch (err) {
    log.error("facebook.oauth_failed", { error: err });
    await clearOAuthCookie();
    return back("/innstillinger?fb=feil#facebook");
  }
}
