import { hashtagSchema } from "../posts/validation";
import type { Product } from "../types";
import type { GeneratedPost } from "./schemas";

/**
 * Deterministisk kontroll av Claudes forslag FØR de lagres.
 * Fanger opp oppdiktede priser, lenker, rabatter, kundeuttalelser og
 * gjentakelser – uansett hva modellen har svart.
 */
export interface PostcheckContext {
  products: Product[];
  productImageIds: Set<string>;
  mediaIds?: Set<string>;
  website: string;
  recentTexts: string[];
  fallbackTimes: string[]; // ISO, én per innlegg
  now: Date;
  defaultHashtags: string[];
}

export interface CheckedPost extends GeneratedPost {
  warnings: string[];
  scheduled_at: string;
}

const PRICE_RE = /(\d{1,3}(?:[ . ]\d{3})*|\d+)(?:,(\d{1,2}|-))?\s*(?:kr\b|kroner|nok\b|,-)/gi;
const KR_PREFIX_RE = /\bkr\.?\s*(\d{1,3}(?:[ . ]\d{3})*|\d+)(?:,(\d{1,2}|-))?/gi;
const DISCOUNT_RE = /\b(rabatt|tilbud|salg|avslag|halv pris|gratis frakt|rabattkode|kampanjepris|\d+\s?%)/i;
const SCARCITY_RE = /\b(kun\s+\d+\s+igjen|nesten utsolgt|bare noen få igjen|siste sjanse|begrenset antall)\b/i;
const TESTIMONIAL_RE = /(skriver en (fornøyd )?kunde|sier en (fornøyd )?kunde|fornøyde kunder sier|«[^»]{5,}»\s*[-–]\s*[A-ZÆØÅ][a-zæøå]+)/i;

export function extractPrices(text: string): number[] {
  const out: number[] = [];
  const toNum = (int: string, dec?: string) => Number(int.replace(/[ . ]/g, "")) + (dec && dec !== "-" ? Number(`0.${dec}`) : 0);
  for (const m of text.matchAll(PRICE_RE)) out.push(toNum(m[1]!, m[2]));
  for (const m of text.matchAll(KR_PREFIX_RE)) out.push(toNum(m[1]!, m[2]));
  return [...new Set(out)];
}

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

export function similarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

function sameOrigin(url: string, website: string): boolean {
  try {
    const u = new URL(url);
    const w = new URL(website);
    return u.protocol === "https:" && u.hostname.replace(/^www\./, "") === w.hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

export function postcheck(post: GeneratedPost, index: number, ctx: PostcheckContext): CheckedPost {
  const warnings: string[] = [...post.needs_verification];
  const product = post.product_id ? ctx.products.find((p) => p.id === post.product_id) ?? null : null;
  if (post.product_id && !product) warnings.push("Claude refererte til et produkt som ikke finnes i biblioteket – koblingen er fjernet.");

  // Lenker: kun produktlenker fra biblioteket eller nettbutikkens domene.
  const allowedLinks = new Set(ctx.products.map((p) => p.product_url).filter(Boolean) as string[]);
  let link = post.link_url?.trim() || null;
  if (link && !allowedLinks.has(link) && !sameOrigin(link, ctx.website)) {
    warnings.push(`Lenken «${link}» er ikke fra nettbutikken og er erstattet.`);
    link = null;
  }
  if (!link) link = product?.product_url ?? ctx.website;

  const fullText = `${post.title}\n${post.body}\n${post.call_to_action}`;

  // Priser: må stemme med biblioteket.
  const prices = extractPrices(fullText);
  if (prices.length) {
    const known = ctx.products.map((p) => p.price).filter((p): p is number => p !== null);
    const allowed = product?.price != null ? [product.price] : known;
    const bad = prices.filter((p) => !allowed.some((a) => Math.abs(a - p) < 0.01));
    if (bad.length) warnings.push(`Teksten nevner pris (${bad.join(", ")} kr) som ikke stemmer med produktbiblioteket. Rett eller fjern før godkjenning.`);
  }
  if (DISCOUNT_RE.test(fullText)) warnings.push("Teksten nevner rabatt/tilbud/salg. Bekreft at dette faktisk gjelder, eller fjern det.");
  if (SCARCITY_RE.test(fullText)) warnings.push("Teksten antyder knapphet. Fjern dette med mindre det er dokumentert sant.");
  if (TESTIMONIAL_RE.test(fullText)) warnings.push("Teksten ser ut til å inneholde en kundeuttalelse. Bruk kun ekte, godkjente uttalelser.");
  if (product?.needs_verification) warnings.push(`Produktopplysningene for «${product.name}» er merket som ikke bekreftet.`);

  for (const prev of ctx.recentTexts) {
    if (similarity(post.body, prev) > 0.35) {
      warnings.push("Teksten ligner mye på et tidligere innlegg. Vurder å generere ny tekst.");
      break;
    }
  }

  const tags: string[] = [];
  for (const t of post.hashtags) {
    const r = hashtagSchema.safeParse(t);
    if (r.success && !tags.includes(r.data)) tags.push(r.data);
  }

  let when = new Date(post.recommended_publish_at);
  const fallback = ctx.fallbackTimes[index] ?? ctx.fallbackTimes[ctx.fallbackTimes.length - 1];
  if (Number.isNaN(when.getTime()) || when.getTime() < ctx.now.getTime() + 15 * 60_000) {
    when = fallback ? new Date(fallback) : new Date(ctx.now.getTime() + 24 * 3600_000);
  }

  return {
    ...post,
    product_id: product?.id ?? null,
    link_url: link,
    hashtags: tags.slice(0, 8),
    suggested_image_id: post.suggested_image_id && ctx.productImageIds.has(post.suggested_image_id) ? post.suggested_image_id : null,
    suggested_media_id: post.suggested_media_id && ctx.mediaIds?.has(post.suggested_media_id) ? post.suggested_media_id : null,
    warnings: [...new Set(warnings)],
    scheduled_at: when.toISOString(),
  };
}

/** Setter sammen brødtekst og handlingsoppfordring uten dobbel CTA. */
export function composeBody(post: Pick<GeneratedPost, "body" | "call_to_action">): string {
  const body = post.body.trim();
  const cta = post.call_to_action.trim();
  if (!cta || body.toLowerCase().includes(cta.toLowerCase())) return body;
  return `${body}\n\n${cta}`;
}
