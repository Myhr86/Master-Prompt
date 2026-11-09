/**
 * Sporingskoder (UTM) på lenker til nettbutikken, slik at Shopify kan vise
 * hvilke Facebook-innlegg som gir besøk og salg.
 *
 * Kodene legges på når innlegget lages/redigeres – før godkjenning – slik at
 * lenken som publiseres er nøyaktig den eieren har godkjent.
 */
export interface UtmSettings {
  enabled: boolean;
  source: string;
  medium: string;
}

export const DEFAULT_UTM: UtmSettings = { enabled: true, source: "facebook", medium: "social" };

/** Kort, stabil kode per innlegg (vises også i appen). */
export function utmContentFor(postId: string): string {
  return postId.replace(/-/g, "").slice(0, 8);
}

export function slugCampaign(value: string | null | undefined): string {
  const s = (value ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || "innlegg";
}

function sameStore(url: URL, website: string): boolean {
  try {
    const host = (h: string) => h.replace(/^www\./, "").toLowerCase();
    return host(url.hostname) === host(new URL(website).hostname);
  } catch {
    return false;
  }
}

/**
 * Legger på (eller oppdaterer) UTM-parametere for lenker til nettbutikken.
 * Andre domener og ugyldige lenker returneres uendret. Andre parametere beholdes.
 */
export function withUtm(link: string | null, website: string, opts: { settings: UtmSettings; campaign: string | null | undefined; postId: string }): string | null {
  if (!link || !opts.settings.enabled) return link;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return link;
  }
  if (u.protocol !== "https:" || !sameStore(u, website)) return link;
  u.searchParams.set("utm_source", opts.settings.source);
  u.searchParams.set("utm_medium", opts.settings.medium);
  u.searchParams.set("utm_campaign", slugCampaign(opts.campaign));
  u.searchParams.set("utm_content", utmContentFor(opts.postId));
  return u.toString();
}

/** Leser innstillingene, med trygge standardverdier hvis migrasjon 6 ikke er kjørt. */
export function utmFromSettings(s: { utm_enabled?: boolean | null; utm_source?: string | null; utm_medium?: string | null }): UtmSettings {
  return {
    enabled: s.utm_enabled ?? DEFAULT_UTM.enabled,
    source: s.utm_source || DEFAULT_UTM.source,
    medium: s.utm_medium || DEFAULT_UTM.medium,
  };
}

/** Leser sporingskoden fra en lenke (for visning). */
export function readUtm(link: string | null): { campaign: string; content: string } | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    const content = u.searchParams.get("utm_content");
    if (!content) return null;
    return { campaign: u.searchParams.get("utm_campaign") ?? "", content };
  } catch {
    return null;
  }
}
