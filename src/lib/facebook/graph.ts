import { createHmac } from "node:crypto";

/**
 * Klient for Metas offisielle Graph API. Kun minimale tillatelser brukes:
 * pages_show_list, pages_manage_posts, pages_read_engagement.
 * API-versjonen settes i META_GRAPH_API_VERSION (ingen hardkodet versjon).
 */
export const REQUIRED_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"] as const;

export interface GraphConfig {
  appId: string;
  appSecret: string;
  version: string; // f.eks. "v24.0"
  /** Valgfri konfigurasjons-ID for «Facebook Login for Business». */
  loginConfigId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
    public readonly kind: "token" | "permission" | "transient" | "unknown_outcome" | "client" = "client",
  ) {
    super(message);
    this.name = "GraphError";
  }
  /** Tokenet er utløpt/ugyldig/tilbakekalt => må koble til på nytt. */
  get needsReconnect() {
    return this.kind === "token";
  }
}

export interface PagePost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  status_type?: string;
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
}

function classify(status: number, code?: number): GraphError["kind"] {
  if (code === 190 || code === 102 || code === 463 || code === 467) return "token";
  if (code === 10 || (code !== undefined && code >= 200 && code < 300)) return "permission";
  if (code === 1 || code === 2 || code === 4 || code === 17 || code === 32 || code === 341 || code === 613) return "transient";
  if (status >= 500) return "unknown_outcome";
  return "client";
}

export class GraphClient {
  private readonly f: typeof fetch;
  constructor(private readonly cfg: GraphConfig) {
    this.f = cfg.fetchImpl ?? fetch;
  }

  get base() {
    return `https://graph.facebook.com/${this.cfg.version}`;
  }

  /** appsecret_proof gjør stjålne tokens ubrukelige uten app-hemmeligheten. */
  proof(token: string) {
    return createHmac("sha256", this.cfg.appSecret).update(token).digest("hex");
  }

  loginUrl(state: string, redirectUri: string): string {
    const u = new URL(`https://www.facebook.com/${this.cfg.version}/dialog/oauth`);
    u.searchParams.set("client_id", this.cfg.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    if (this.cfg.loginConfigId) {
      // Facebook Login for Business: tillatelsene er definert i konfigurasjonen hos Meta
      // (skal være nøyaktig de tre i REQUIRED_SCOPES). De kontrolleres etter innlogging.
      u.searchParams.set("config_id", this.cfg.loginConfigId);
    } else {
      u.searchParams.set("scope", REQUIRED_SCOPES.join(","));
      u.searchParams.set("auth_type", "rerequest");
    }
    return u.toString();
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string>, token?: string): Promise<T> {
    const all: Record<string, string> = { ...params };
    if (token) {
      all.access_token = token;
      all.appsecret_proof = this.proof(token);
    }
    const url = new URL(`${this.base}/${path.replace(/^\//, "")}`);
    let body: URLSearchParams | undefined;
    if (method === "GET") Object.entries(all).forEach(([k, v]) => url.searchParams.set(k, v));
    else body = new URLSearchParams(all);

    let res: Response;
    try {
      res = await this.f(url, {
        method,
        body,
        headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 25_000),
        cache: "no-store",
      });
    } catch (err) {
      // Nettverksfeil/tidsavbrudd: vi vet IKKE om Facebook utførte handlingen.
      throw new GraphError(`Ingen svar fra Facebook (${(err as Error).name})`, 0, undefined, undefined, "unknown_outcome");
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok || (json && typeof json === "object" && "error" in json)) {
      const e = (json as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
      throw new GraphError(e?.message ?? `Facebook svarte med HTTP ${res.status}`, res.status, e?.code, e?.error_subcode, classify(res.status, e?.code));
    }
    if (json === null) throw new GraphError("Uleselig svar fra Facebook", res.status, undefined, undefined, "unknown_outcome");
    return json as T;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const r = await this.request<{ access_token: string }>("GET", "oauth/access_token", {
      client_id: this.cfg.appId,
      client_secret: this.cfg.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    return r.access_token;
  }

  async exchangeLongLived(userToken: string): Promise<{ token: string; expiresAt: Date | null }> {
    const r = await this.request<{ access_token: string; expires_in?: number }>("GET", "oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.cfg.appId,
      client_secret: this.cfg.appSecret,
      fb_exchange_token: userToken,
    });
    return { token: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null };
  }

  async grantedPermissions(userToken: string): Promise<string[]> {
    const r = await this.request<{ data: { permission: string; status: string }[] }>("GET", "me/permissions", {}, userToken);
    return r.data.filter((p) => p.status === "granted").map((p) => p.permission);
  }

  async listPages(userToken: string): Promise<FacebookPage[]> {
    const r = await this.request<{ data: FacebookPage[] }>("GET", "me/accounts", { fields: "id,name,access_token,tasks", limit: "100" }, userToken);
    return r.data;
  }

  /** Validerer et token og returnerer utløpstid (null = utløper ikke). */
  async debugToken(token: string): Promise<{ isValid: boolean; expiresAt: Date | null; scopes: string[]; granularScopes: { scope: string; target_ids?: string[] }[] }> {
    const r = await this.request<{
      data: { is_valid: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[] };
    }>("GET", "debug_token", { input_token: token, access_token: `${this.cfg.appId}|${this.cfg.appSecret}` });
    const exp = r.data.expires_at && r.data.expires_at > 0 ? new Date(r.data.expires_at * 1000) : null;
    return { isValid: r.data.is_valid, expiresAt: exp, scopes: r.data.scopes ?? [], granularScopes: r.data.granular_scopes ?? [] };
  }

  /**
   * Feilsøking når ingen sider finnes. Returnerer kun ufarlige opplysninger
   * (navn, tillatelser, antall valgte sider) – aldri tokens.
   */
  async diagnose(userToken: string): Promise<{
    userName: string | null;
    tokenType: string | null;
    granted: string[];
    declined: string[];
    selectedPagesPerScope: Record<string, number>;
    accountsCount: number | null;
    accountsError: string | null;
    selectedPages: { id: string; result: string }[];
  }> {
    const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };
    const me = await safe(() => this.request<{ name?: string }>("GET", "me", { fields: "name" }, userToken));
    const perms = await safe(() => this.request<{ data: { permission: string; status: string }[] }>("GET", "me/permissions", {}, userToken));
    const dbg = await safe(() =>
      this.request<{ data: { type?: string; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>("GET", "debug_token", {
        input_token: userToken,
        access_token: `${this.cfg.appId}|${this.cfg.appSecret}`,
      }),
    );
    let accountsCount: number | null = null;
    let accountsError: string | null = null;
    try {
      accountsCount = (await this.listPages(userToken)).length;
    } catch (e) {
      accountsError = (e as Error).message;
    }
    const selected: Record<string, number> = {};
    for (const g of dbg?.data.granular_scopes ?? []) selected[g.scope] = g.target_ids ? g.target_ids.length : -1;
    // Prøv å hente hver valgt side direkte, og rapporter resultatet (uten tokens).
    const ids = [...new Set((dbg?.data.granular_scopes ?? []).flatMap((g) => g.target_ids ?? []))].slice(0, 5);
    const selectedPages: { id: string; result: string }[] = [];
    for (const id of ids) {
      try {
        const p = await this.request<{ id: string; name?: string; access_token?: string }>("GET", id, { fields: "id,name,access_token" }, userToken);
        selectedPages.push({ id, result: `navn=${p.name ?? "?"}, sidetoken=${p.access_token ? "ja" : "NEI"}` });
      } catch (e) {
        const ge = e as GraphError;
        let basic = "";
        try {
          const b = await this.request<{ id: string; name?: string }>("GET", id, { fields: "id,name" }, userToken);
          basic = ` | uten token-felt: navn=${b.name ?? "?"}`;
        } catch (e2) {
          basic = ` | uten token-felt: FEIL ${(e2 as Error).message}`;
        }
        selectedPages.push({ id, result: `FEIL (kode ${ge.code ?? "?"}${ge.subcode ? `/${ge.subcode}` : ""}): ${ge.message}${basic}` });
      }
    }
    return {
      userName: me?.name ?? null,
      tokenType: dbg?.data.type ?? null,
      granted: (perms?.data ?? []).filter((x) => x.status === "granted").map((x) => x.permission),
      declined: (perms?.data ?? []).filter((x) => x.status !== "granted").map((x) => x.permission),
      selectedPagesPerScope: selected,
      accountsCount,
      accountsError,
      selectedPages,
    };
  }

  /** Henter én side med sidetoken via brukertokenet. */
  async getPage(pageId: string, userToken: string): Promise<FacebookPage> {
    // "tasks" finnes bare i /me/accounts, ikke på selve sidenoden.
    return this.request<FacebookPage>("GET", pageId, { fields: "id,name,access_token" }, userToken);
  }

  /**
   * Sidene brukeren har gitt appen tilgang til. /me/accounts er ofte tom for
   * sider av den nye typen og sider som eies via Meta Business – da brukes
   * sidene brukeren valgte i innloggingsdialogen (granular_scopes) som reserve.
   * Ingen ekstra tillatelser kreves.
   */
  async accessiblePages(userToken: string): Promise<FacebookPage[]> {
    const pages = await this.listPages(userToken);
    if (pages.length) return pages;
    const info = await this.debugToken(userToken);
    const ids = [
      ...new Set(
        info.granularScopes
          .filter((g) => g.scope === "pages_show_list" || g.scope === "pages_manage_posts" || g.scope === "pages_read_engagement")
          .flatMap((g) => g.target_ids ?? []),
      ),
    ];
    const found: FacebookPage[] = [];
    for (const id of ids.slice(0, 25)) {
      try {
        const p = await this.getPage(id, userToken);
        if (p.access_token) found.push(p);
      } catch (err) {
        if (err instanceof GraphError && err.needsReconnect) throw err;
      }
    }
    return found;
  }

  async publishFeed(pageId: string, pageToken: string, input: { message: string; link?: string | null }): Promise<{ id: string }> {
    const params: Record<string, string> = { message: input.message };
    if (input.link) params.link = input.link;
    return this.request<{ id: string }>("POST", `${pageId}/feed`, params, pageToken);
  }

  async publishPhoto(pageId: string, pageToken: string, input: { imageUrl: string; caption: string }): Promise<{ id: string; post_id?: string }> {
    return this.request<{ id: string; post_id?: string }>("POST", `${pageId}/photos`, { url: input.imageUrl, caption: input.caption, published: "true" }, pageToken);
  }

  async getPost(postId: string, pageToken: string): Promise<{ id: string; permalink_url?: string; created_time?: string; message?: string }> {
    return this.request("GET", postId, { fields: "id,permalink_url,created_time,message" }, pageToken);
  }

  /** Brukes for å avklare uklare publiseringsresultater før nytt forsøk. */
  async findPublishedByMessage(pageId: string, pageToken: string, message: string, since: Date): Promise<{ id: string; permalink_url?: string } | null> {
    const r = await this.request<{ data: { id: string; message?: string; created_time?: string; permalink_url?: string }[] }>(
      "GET",
      `${pageId}/published_posts`,
      { fields: "id,message,created_time,permalink_url", since: String(Math.floor(since.getTime() / 1000) - 300), limit: "25" },
      pageToken,
    );
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    return r.data.find((p) => p.message && norm(p.message) === norm(message)) ?? null;
  }

  /**
   * Henter publiserte innlegg på siden (nyeste først), med sidevisning.
   * Krever pages_read_engagement.
   */
  /**
   * Feltsett for engasjement, fra mest til minst. Kommentarantall kan kreve
   * tillatelsen pages_read_user_content (som appen bevisst ikke ber om) –
   * da faller vi tilbake til feltene tillatelsene faktisk dekker.
   */
  static readonly ENGAGEMENT_FIELDSETS = [
    "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
    "reactions.summary(total_count).limit(0),shares",
    "",
  ];
  private engagementLevel = 0;

  /** Kjører en forespørsel med beste tilgjengelige engasjementsfelt, og husker hva som virket. */
  private async withEngagementFallback<T>(run: (fields: string) => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await run(GraphClient.ENGAGEMENT_FIELDSETS[this.engagementLevel]!);
      } catch (err) {
        const last = this.engagementLevel >= GraphClient.ENGAGEMENT_FIELDSETS.length - 1;
        if (err instanceof GraphError && (err.kind === "permission" || err.code === 100) && !last) {
          this.engagementLevel++;
          continue;
        }
        throw err;
      }
    }
  }

  /** Hvilke engasjementstall som faktisk kunne hentes (etter siste kall). */
  get engagementCoverage(): "alle" | "uten_kommentarer" | "ingen" {
    return (["alle", "uten_kommentarer", "ingen"] as const)[this.engagementLevel]!;
  }

  /**
   * Henter publiserte innlegg på siden (nyeste først), med sidevisning.
   * Engasjement hentes i samme kall når tillatelsene tillater det.
   */
  async listPublishedPosts(pageId: string, pageToken: string, max = 100): Promise<PagePost[]> {
    return this.withEngagementFallback(async (engagement) => {
      const out: PagePost[] = [];
      let after: string | undefined;
      while (out.length < max) {
        const params: Record<string, string> = {
          fields: ["id,message,created_time,permalink_url,full_picture,status_type", engagement].filter(Boolean).join(","),
          limit: String(Math.min(50, max - out.length)),
        };
        if (after) params.after = after;
        const r = await this.request<{ data: PagePost[]; paging?: { cursors?: { after?: string }; next?: string } }>("GET", `${pageId}/published_posts`, params, pageToken);
        out.push(...r.data);
        after = r.paging?.cursors?.after;
        if (!r.paging?.next || !after || r.data.length === 0) break;
      }
      return out.slice(0, max);
    });
  }

  async getEngagement(postId: string, pageToken: string): Promise<Record<string, number>> {
    const r = await this.withEngagementFallback((fields) =>
      fields
        ? this.request<{ reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }>("GET", postId, { fields }, pageToken)
        : Promise.resolve({} as { reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }),
    );
    const out: Record<string, number> = {};
    if (r.reactions?.summary?.total_count !== undefined) out.reactions = r.reactions.summary.total_count;
    if (r.comments?.summary?.total_count !== undefined) out.comments = r.comments.summary.total_count;
    if (r.shares?.count !== undefined || r.reactions) out.shares = r.shares?.count ?? 0;
    return out;
  }

  /** Henter innsiktsmetrikker. Metrikker som ikke er tilgjengelige hoppes over (ingen gjetting). */
  async getInsights(postId: string, pageToken: string, metrics: string[]): Promise<{ values: Record<string, number>; unavailable: string[] }> {
    const values: Record<string, number> = {};
    const unavailable: string[] = [];
    for (const metric of metrics) {
      try {
        const r = await this.request<{ data: { name: string; values: { value: number | Record<string, number> }[] }[] }>(
          "GET",
          `${postId}/insights`,
          { metric },
          pageToken,
        );
        const v = r.data[0]?.values?.[0]?.value;
        if (typeof v === "number") values[metric] = v;
        else if (v && typeof v === "object") values[metric] = Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0);
        else unavailable.push(metric);
      } catch (err) {
        if (err instanceof GraphError && err.needsReconnect) throw err;
        unavailable.push(metric);
      }
    }
    return { values, unavailable };
  }

}

export function postUrl(facebookPostId: string): string {
  return `https://www.facebook.com/${facebookPostId}`;
}
