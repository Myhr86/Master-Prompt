/**
 * Henter OFFENTLIG produktinformasjon fra nettbutikken.
 * Støtter Shopify (products.json), WooCommerce Store API og enkeltsider
 * med strukturert data (JSON-LD / Open Graph). Ingenting gjettes: felter som
 * ikke finnes i kilden blir stående tomme.
 */
export interface ImportedProduct {
  externalId: string;
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  url: string;
  imageUrls: string[];
}

export interface ImportResult {
  platform: "shopify" | "woocommerce" | "page";
  products: ImportedProduct[];
}

const MAX_BYTES = 5 * 1024 * 1024;

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Tillater kun https-forespørsler til nettbutikkens eget domene (SSRF-vern). */
export function assertAllowedUrl(url: string, website: string): URL {
  const u = new URL(url);
  const w = new URL(website);
  const host = (h: string) => h.replace(/^www\./, "").toLowerCase();
  if (u.protocol !== "https:") throw new Error("Kun https-adresser er tillatt");
  if (host(u.hostname) !== host(w.hostname)) throw new Error("Adressen må være på nettbutikkens domene");
  return u;
}

/**
 * Henter tekst med manuell håndtering av omdirigeringer: hvert hopp må være
 * https på nettbutikkens domene, slik at en omdirigering ikke kan sende
 * serveren til interne adresser (SSRF).
 */
async function fetchText(url: string, website: string, fetchImpl: typeof fetch): Promise<{ status: number; text: string; type: string }> {
  let current = assertAllowedUrl(url, website).toString();
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchImpl(current, {
      headers: { Accept: "application/json, text/html;q=0.9", "User-Agent": "MyhrSocialManager/1.0 (+produktimport)" },
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Ugyldig omdirigering fra nettbutikken");
      current = assertAllowedUrl(new URL(location, current).toString(), website).toString();
      continue;
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("Svaret fra nettbutikken er for stort");
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("Svaret fra nettbutikken er for stort");
    return { status: res.status, text, type: res.headers.get("content-type") ?? "" };
  }
  throw new Error("For mange omdirigeringer");
}

/** Gjør bilde-URL-er absolutte og https, fjerner duplikater. */
export function normalizeImageUrls(urls: string[], base: string): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    try {
      const u = new URL(raw.trim(), base);
      if (u.protocol === "http:") u.protocol = "https:";
      if (u.protocol !== "https:") continue;
      if (!out.includes(u.toString())) out.push(u.toString());
    } catch {
      /* ugyldig URL ignoreres */
    }
  }
  return out.slice(0, 6);
}

function toPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function parseShopify(json: unknown, website: string): ImportedProduct[] {
  const products = (json as { products?: unknown[] })?.products;
  if (!Array.isArray(products)) return [];
  const origin = new URL(website).origin;
  return products.map((raw) => {
    const p = raw as { id: number | string; title: string; body_html?: string; handle: string; variants?: { price?: string }[]; images?: { src: string }[] };
    const prices = (p.variants ?? []).map((v) => toPrice(v.price)).filter((x): x is number => x !== null);
    return {
      externalId: `shopify:${p.id}`,
      name: p.title,
      description: stripHtml(p.body_html ?? ""),
      // Ved flere varianter brukes laveste pris; eieren kan justere.
      price: prices.length ? Math.min(...prices) : null,
      currency: null,
      url: `${origin}/products/${p.handle}`,
      imageUrls: normalizeImageUrls((p.images ?? []).map((i) => i.src), website),
    };
  });
}

export function parseWooCommerce(json: unknown): ImportedProduct[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const p = raw as { id: number; name: string; description?: string; short_description?: string; permalink: string; prices?: { price?: string; currency_code?: string; currency_minor_unit?: number }; images?: { src: string }[] };
    const minor = p.prices?.currency_minor_unit ?? 2;
    const price = p.prices?.price ? Number(p.prices.price) / 10 ** minor : null;
    return {
      externalId: `woo:${p.id}`,
      name: stripHtml(p.name),
      description: stripHtml(p.description || p.short_description || ""),
      price: price !== null && Number.isFinite(price) ? price : null,
      currency: p.prices?.currency_code ?? null,
      url: p.permalink,
      imageUrls: normalizeImageUrls((p.images ?? []).map((i) => i.src), p.permalink),
    };
  });
}

/** Leser schema.org/Product fra JSON-LD, med Open Graph som reserve. */
export function parseProductPage(html: string, url: string): ImportedProduct | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  const candidates: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) candidates.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
  };
  for (const b of blocks) {
    try {
      visit(JSON.parse(b.trim()));
    } catch {
      /* ugyldig JSON-LD ignoreres */
    }
  }
  const og = (prop: string) => html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ?? null;

  const p = candidates[0];
  if (p) {
    const offers = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : [];
    const firstOffer = offers[0] as Record<string, unknown> | undefined;
    const price = toPrice(firstOffer?.price ?? (firstOffer?.priceSpecification as Record<string, unknown> | undefined)?.price ?? firstOffer?.lowPrice);
    const images = Array.isArray(p.image) ? p.image : p.image ? [p.image] : [];
    return {
      externalId: `url:${url}`,
      name: stripHtml(String(p.name ?? og("og:title") ?? "")),
      description: stripHtml(String(p.description ?? og("og:description") ?? "")),
      price,
      currency: (firstOffer?.priceCurrency as string | undefined) ?? null,
      url,
      imageUrls: normalizeImageUrls(images.map((i) => (typeof i === "string" ? i : String((i as { url?: string }).url ?? ""))).filter(Boolean), url),
    };
  }
  const title = og("og:title");
  if (!title) return null;
  return {
    externalId: `url:${url}`,
    name: stripHtml(title),
    description: stripHtml(og("og:description") ?? ""),
    price: toPrice(og("product:price:amount")),
    currency: og("product:price:currency"),
    url,
    imageUrls: normalizeImageUrls([og("og:image")].filter((x): x is string => Boolean(x)), url),
  };
}

export async function importFromStore(website: string, fetchImpl: typeof fetch = fetch): Promise<ImportResult> {
  const origin = new URL(website).origin;
  // 1) Shopify
  try {
    const r = await fetchText(`${origin}/products.json?limit=250`, website, fetchImpl);
    if (r.status === 200 && r.type.includes("json")) {
      const products = parseShopify(JSON.parse(r.text), website);
      if (products.length) return { platform: "shopify", products };
    }
  } catch {
    /* prøv neste */
  }
  // 2) WooCommerce Store API
  try {
    const r = await fetchText(`${origin}/wp-json/wc/store/v1/products?per_page=100`, website, fetchImpl);
    if (r.status === 200 && r.type.includes("json")) {
      const products = parseWooCommerce(JSON.parse(r.text));
      if (products.length) return { platform: "woocommerce", products };
    }
  } catch {
    /* ingen flere automatiske kilder */
  }
  throw new Error("Fant ingen produktliste automatisk. Legg inn produktlenker én og én i stedet.");
}

export class NotAProductPageError extends Error {
  constructor() {
    super("Adressen er ikke en produktside. Bruk adressen til ett produkt (…/products/…), eller trykk «Hent alle produkter».");
    this.name = "NotAProductPageError";
  }
}

/** Sant for forside, kolleksjoner, «alle produkter» o.l. – sider med mange produkter. */
export function isListingUrl(url: string): boolean {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  return path === "" || /^\/(collections|shop|butikk|produkter|kategori|product-category)(\/|$)/i.test(path);
}

export async function importProductPage(url: string, website: string, fetchImpl: typeof fetch = fetch): Promise<ImportedProduct> {
  const u = assertAllowedUrl(url, website);
  // Shopify: produktdata som JSON er mer pålitelig enn å lese HTML.
  const handle = u.pathname.match(/\/products\/([^/?#.]+)/)?.[1];
  if (handle) {
    try {
      const r = await fetchText(`${u.origin}/products/${handle}.json`, website, fetchImpl);
      if (r.status === 200 && r.type.includes("json")) {
        const product = (JSON.parse(r.text) as { product?: unknown }).product;
        const [p] = product ? parseShopify({ products: [product] }, website) : [];
        if (p?.name) return p;
      }
    } catch {
      /* faller tilbake til HTML */
    }
  }
  const r = await fetchText(u.toString(), website, fetchImpl);
  if (r.status !== 200) throw new Error(`Siden svarte med HTTP ${r.status}`);
  const p = parseProductPage(r.text, u.toString());
  if (!p || !p.name) throw new NotAProductPageError();
  return p;
}

export interface ProductFields {
  name: string;
  description: string;
  price: number | null;
  product_url: string | null;
}

/** Sammenligner lagret produkt med kilden og returnerer endringsforslag. */
export function diffProduct(current: ProductFields, imported: ImportedProduct): { field: keyof ProductFields; current: string | null; proposed: string | null }[] {
  const out: { field: keyof ProductFields; current: string | null; proposed: string | null }[] = [];
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
  if (norm(current.name) !== norm(imported.name) && imported.name) out.push({ field: "name", current: current.name, proposed: imported.name });
  if (imported.description && norm(current.description) !== norm(imported.description)) out.push({ field: "description", current: current.description, proposed: imported.description });
  if (imported.price !== null && (current.price === null || Math.abs(Number(current.price) - imported.price) >= 0.01)) {
    out.push({ field: "price", current: current.price === null ? null : String(current.price), proposed: String(imported.price) });
  }
  if (imported.url && current.product_url !== imported.url) out.push({ field: "product_url", current: current.product_url, proposed: imported.url });
  return out;
}
