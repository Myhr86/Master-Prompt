import "server-only";
import { createAdminClient } from "../supabase/admin";
import { decryptSecret, encryptSecret } from "../crypto";
import { env, integrations } from "../env";
import { GraphClient } from "./graph";
import type { FacebookConnectionSecret } from "../posts/publisher";
import { log } from "../logger";

/** Graph-klient, eller null hvis Meta-appen ikke er konfigurert. */
export function graphClient(): GraphClient | null {
  if (!integrations().meta) return null;
  const e = env();
  return new GraphClient({ appId: e.META_APP_ID!, appSecret: e.META_APP_SECRET!, version: e.META_GRAPH_API_VERSION!, loginConfigId: e.META_LOGIN_CONFIG_ID });
}

export function facebookRedirectUri(): string {
  return new URL("/api/facebook/callback", env().APP_URL).toString();
}

/** Leser aktiv tilkobling inkl. dekryptert token. KUN for server-side bruk. */
export async function getConnectionSecret(): Promise<FacebookConnectionSecret | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("facebook_connections")
    .select("page_id, page_name, encrypted_access_token, connection_status, token_expires_at")
    .neq("connection_status", "disconnected")
    .maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_access_token) return null;
  return {
    pageId: data.page_id,
    pageName: data.page_name,
    token: decryptSecret(data.encrypted_access_token, env().TOKEN_ENCRYPTION_KEY),
    status: data.connection_status,
    expiresAt: data.token_expires_at ? new Date(data.token_expires_at) : null,
  };
}

export async function saveConnection(input: {
  pageId: string;
  pageName: string;
  pageToken: string;
  expiresAt: Date | null;
  scopes: string[];
  connectedBy: string;
}) {
  const admin = createAdminClient();
  // Koble fra eventuell eksisterende tilkobling først (kun én aktiv).
  await disconnect();
  const { error } = await admin.from("facebook_connections").insert({
    page_id: input.pageId,
    page_name: input.pageName,
    encrypted_access_token: encryptSecret(input.pageToken, env().TOKEN_ENCRYPTION_KEY),
    token_expires_at: input.expiresAt?.toISOString() ?? null,
    connection_status: "connected",
    granted_scopes: input.scopes,
    connected_by: input.connectedBy,
    last_checked_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function setConnectionStatus(status: "connected" | "expired" | "revoked" | "error", lastError: string | null) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("facebook_connections")
    .update({ connection_status: status, last_error: lastError, last_checked_at: new Date().toISOString() })
    .neq("connection_status", "disconnected");
  if (error) log.error("facebook.status_update_failed", { error: error.message });
}

/** Sletter tokenet permanent og markerer tilkoblingen som frakoblet. */
export async function disconnect() {
  const admin = createAdminClient();
  const { error } = await admin
    .from("facebook_connections")
    .update({ connection_status: "disconnected", encrypted_access_token: null, last_error: null })
    .neq("connection_status", "disconnected");
  if (error) throw error;
}

/** Kontrollerer tokenet mot Facebook og oppdaterer status. */
export async function verifyConnection(): Promise<{ ok: boolean; message: string }> {
  const graph = graphClient();
  if (!graph) return { ok: false, message: "Meta-appen er ikke konfigurert på serveren." };
  const conn = await getConnectionSecret();
  if (!conn) return { ok: false, message: "Ingen Facebook-side er tilkoblet." };
  try {
    const info = await graph.debugToken(conn.token);
    if (!info.isValid) {
      await setConnectionStatus("expired", "Tokenet er ikke lenger gyldig");
      return { ok: false, message: "Tilgangen er utløpt eller tilbakekalt. Koble til på nytt." };
    }
    const missing = ["pages_manage_posts", "pages_read_engagement"].filter((s) => !info.scopes.includes(s));
    if (missing.length) {
      await setConnectionStatus("error", `Mangler tillatelser: ${missing.join(", ")}`);
      return { ok: false, message: `Mangler tillatelser hos Facebook: ${missing.join(", ")}.` };
    }
    const admin = createAdminClient();
    await admin
      .from("facebook_connections")
      .update({ connection_status: "connected", last_error: null, last_checked_at: new Date().toISOString(), token_expires_at: info.expiresAt?.toISOString() ?? null, granted_scopes: info.scopes })
      .neq("connection_status", "disconnected");
    return { ok: true, message: "Tilkoblingen fungerer." };
  } catch (err) {
    log.warn("facebook.verify_failed", { error: err });
    await setConnectionStatus("error", "Kunne ikke kontrollere tilkoblingen");
    return { ok: false, message: "Kunne ikke kontrollere tilkoblingen mot Facebook." };
  }
}
