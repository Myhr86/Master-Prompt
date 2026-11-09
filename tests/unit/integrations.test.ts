import { describe, expect, it, vi } from "vitest";
import { GraphClient, GraphError, REQUIRED_SCOPES } from "@/lib/facebook/graph";
import { OpenAIImageProvider } from "@/lib/images/providers/openai";
import { assertAllowedUrl, diffProduct, importFromStore, importProductPage, parseProductPage, parseShopify, parseWooCommerce, stripHtml } from "@/lib/products/importer";

describe("Facebook Login og Graph API", () => {
  const g = new GraphClient({ appId: "123", appSecret: "s3cr3t", version: "v99.0" });

  it("ber kun om de tre minimale tillatelsene", () => {
    const url = new URL(g.loginUrl("state123", "https://app.example/api/facebook/callback"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v99.0/dialog/oauth");
    const scopes = url.searchParams.get("scope")!.split(",");
    expect(scopes.sort()).toEqual(["pages_manage_posts", "pages_read_engagement", "pages_show_list"]);
    for (const forbidden of ["pages_messaging", "ads_management", "user_posts", "email", "public_profile", "business_management", "read_page_mailboxes"]) {
      expect(scopes).not.toContain(forbidden);
    }
    expect(REQUIRED_SCOPES).toHaveLength(3);
    expect(url.searchParams.get("state")).toBe("state123");
  });

  it("støtter Facebook Login for Business (config_id i stedet for scope)", () => {
    const u = new URL(new GraphClient({ appId: "1", appSecret: "2", version: "v9.0", loginConfigId: "cfg42" }).loginUrl("s", "https://x/cb"));
    expect(u.searchParams.get("config_id")).toBe("cfg42");
    expect(u.searchParams.get("scope")).toBeNull();
  });

  it("bruker versjonen fra konfigurasjonen (ingen hardkodet versjon)", () => {
    expect(new GraphClient({ appId: "1", appSecret: "2", version: "v42.0" }).base).toBe("https://graph.facebook.com/v42.0");
  });

  it("sender token i POST-body med appsecret_proof, ikke i URL-en", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "1_2" }), { status: 200 }));
    const c = new GraphClient({ appId: "1", appSecret: "s", version: "v1.0", fetchImpl: fetchImpl as unknown as typeof fetch });
    await c.publishFeed("1", "EAAtoken", { message: "hei", link: "https://myhrtreogdesign.com/" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).not.toContain("EAAtoken");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("access_token")).toBe("EAAtoken");
    expect(body.get("appsecret_proof")).toBe(c.proof("EAAtoken"));
  });

  it("klassifiserer feil fra Facebook (test 12)", async () => {
    const mk = (status: number, body: unknown) => new GraphClient({ appId: "1", appSecret: "s", version: "v1.0", fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch });
    await expect(mk(400, { error: { message: "expired", code: 190 } }).publishFeed("1", "t", { message: "x" })).rejects.toMatchObject({ kind: "token", needsReconnect: true });
    await expect(mk(403, { error: { message: "perm", code: 200 } }).publishFeed("1", "t", { message: "x" })).rejects.toMatchObject({ kind: "permission" });
    await expect(mk(400, { error: { message: "rate", code: 4 } }).publishFeed("1", "t", { message: "x" })).rejects.toMatchObject({ kind: "transient" });
    await expect(mk(502, {}).publishFeed("1", "t", { message: "x" })).rejects.toMatchObject({ kind: "unknown_outcome" });
    const net = new GraphClient({ appId: "1", appSecret: "s", version: "v1.0", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    const err = await net.publishFeed("1", "t", { message: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err.kind).toBe("unknown_outcome");
  });

  it("innsikt: utilgjengelige metrikker hoppes over i stedet for å gjettes", async () => {
    const fetchImpl = (async (u: URL) => {
      const metric = new URL(String(u)).searchParams.get("metric");
      if (metric === "post_clicks") return new Response(JSON.stringify({ data: [{ name: "post_clicks", values: [{ value: 7 }] }] }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "invalid metric", code: 100 } }), { status: 400 });
    }) as typeof fetch;
    const c = new GraphClient({ appId: "1", appSecret: "s", version: "v1.0", fetchImpl });
    expect(await c.getInsights("1_2", "t", ["post_clicks", "post_impressions_unique"])).toEqual({ values: { post_clicks: 7 }, unavailable: ["post_impressions_unique"] });
  });
});

describe("Bildegenerator (utskiftbar leverandør)", () => {
  it("er ikke konfigurert uten nøkkel", () => {
    expect(new OpenAIImageProvider(undefined, "gpt-image-1").isConfigured()).toBe(false);
  });
  it("sender forespørsel og dekoder bildet", async () => {
    const png = Buffer.from("fakepng");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }));
    const p = new OpenAIImageProvider("sk-test", "gpt-image-1", fetchImpl as unknown as typeof fetch);
    const r = await p.generate({ prompt: "stue", format: "portrait" });
    expect(r.data.equals(png)).toBe(true);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: "gpt-image-1", size: "1024x1536" });
  });
  it("gir lesbar feil", async () => {
    const p = new OpenAIImageProvider("sk-test", "m", (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as typeof fetch);
    await expect(p.generate({ prompt: "x", format: "square" })).rejects.toThrow(/quota/);
  });
});

describe("Produktimport (offentlig informasjon, ingen gjetting)", () => {
  it("leser Shopify products.json", () => {
    const r = parseShopify({ products: [{ id: 1, title: "Flis", body_html: "<p>Fin <b>flis</b></p>", handle: "flis", variants: [{ price: "549.00" }, { price: "499.00" }], images: [{ src: "https://cdn/x.jpg" }] }] }, "https://myhrtreogdesign.com/");
    expect(r[0]).toMatchObject({ externalId: "shopify:1", name: "Flis", description: "Fin flis", price: 499, url: "https://myhrtreogdesign.com/products/flis" });
  });
  it("leser WooCommerce Store API (minste valutaenhet)", () => {
    const r = parseWooCommerce([{ id: 5, name: "Skjærefjøl", description: "<p>Eik</p>", permalink: "https://myhrtreogdesign.com/p/skjaerefjol", prices: { price: "39900", currency_code: "NOK", currency_minor_unit: 2 } }]);
    expect(r[0]).toMatchObject({ price: 399, currency: "NOK", description: "Eik" });
  });
  it("leser JSON-LD Product og lar manglende pris være tom", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Familieflis","description":"20 x 20 cm","offers":{"@type":"Offer","priceCurrency":"NOK"}}]}</script>`;
    expect(parseProductPage(html, "https://myhrtreogdesign.com/p")).toMatchObject({ name: "Familieflis", price: null, currency: "NOK" });
  });
  it("oppdager endringer som forslag", () => {
    const d = diffProduct({ name: "Flis", description: "A", price: 499, product_url: "https://myhrtreogdesign.com/products/flis" }, { externalId: "x", name: "Flis", description: "A", price: 549, currency: null, url: "https://myhrtreogdesign.com/products/flis", imageUrls: [] });
    expect(d).toEqual([{ field: "price", current: "499", proposed: "549" }]);
  });
  it("tillater kun nettbutikkens eget domene over https (SSRF-vern)", () => {
    expect(() => assertAllowedUrl("https://www.myhrtreogdesign.com/p/1", "https://myhrtreogdesign.com/")).not.toThrow();
    expect(() => assertAllowedUrl("http://myhrtreogdesign.com/p/1", "https://myhrtreogdesign.com/")).toThrow(/https/);
    expect(() => assertAllowedUrl("https://169.254.169.254/latest/meta-data", "https://myhrtreogdesign.com/")).toThrow(/domene/);
    expect(() => assertAllowedUrl("https://myhrtreogdesign.com.evil.no/", "https://myhrtreogdesign.com/")).toThrow(/domene/);
  });
  it("følger ikke omdirigeringer til andre domener (SSRF via redirect)", async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })) as typeof fetch;
    await expect(importProductPage("https://myhrtreogdesign.com/p/1", "https://myhrtreogdesign.com/", fetchImpl)).rejects.toThrow(/https|domene/);
  });

  it("følger omdirigering innen nettbutikkens domene og importerer fra Shopify", async () => {
    const fetchImpl = (async (u: string) => {
      if (u.includes("/products.json") && !u.includes("www.")) return new Response(null, { status: 301, headers: { location: "https://www.myhrtreogdesign.com/products.json?limit=250" } });
      if (u.includes("/products.json")) return new Response(JSON.stringify({ products: [{ id: 9, title: "Flis", handle: "flis", variants: [{ price: "1.00" }] }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await importFromStore("https://myhrtreogdesign.com/", fetchImpl);
    expect(r.platform).toBe("shopify");
    expect(r.products[0]!.name).toBe("Flis");
  });

  it("fjerner HTML og skript", () => {
    expect(stripHtml("<script>alert(1)</script><p>Hei&nbsp;der</p>")).toBe("Hei der");
  });
});
