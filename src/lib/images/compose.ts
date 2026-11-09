import sharp, { type Metadata as SharpMetadata, type OverlayOptions } from "sharp";
import { IMAGE_FORMATS, type ImageFormat } from "./formats";

/**
 * Bildebehandling med sharp.
 *
 * Miljøbilder lages ved KOMPOSISJON: AI genererer kun bakgrunnen/miljøet,
 * og det ekte produktfotoet legges oppå uten å endres (kun skalert
 * proporsjonalt). Slik bevares produktets faktiske utseende, form, ramme og
 * design nøyaktig.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(["jpeg", "png", "webp"]);

/** Validerer et opplastet bilde basert på innholdet (ikke filnavn/MIME fra klienten) og fjerner EXIF/GPS. */
export async function sanitizeUpload(input: Buffer): Promise<{ data: Buffer; width: number; height: number; mimeType: string }> {
  if (input.length === 0) throw new Error("Filen er tom");
  if (input.length > MAX_UPLOAD_BYTES) throw new Error("Bildet er større enn 15 MB");
  let meta: SharpMetadata;
  try {
    meta = await sharp(input, { limitInputPixels: 80_000_000 }).metadata();
  } catch {
    throw new Error("Filen er ikke et gyldig bilde");
  }
  if (!meta.format || !ALLOWED.has(meta.format)) throw new Error("Kun JPEG, PNG og WebP støttes");
  // rotate() bruker EXIF-orientering; re-enkoding fjerner all metadata (bl.a. GPS).
  const pipeline = sharp(input).rotate().resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true });
  const out = meta.format === "png" ? await pipeline.png().toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height, mimeType: meta.format === "png" ? "image/png" : "image/jpeg" };
}

/** Beskjærer/skalerer til et Facebook-vennlig format. */
export async function toFormat(input: Buffer, format: ImageFormat): Promise<Buffer> {
  const { width, height } = IMAGE_FORMATS[format];
  return sharp(input).rotate().resize(width, height, { fit: "cover", position: "attention" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

export interface CompositeOptions {
  format: ImageFormat;
  /** Andel av bildets korteste side produktet skal dekke (0.3–0.85). */
  scale?: number;
  position?: "center" | "bottom" | "left" | "right";
  shadow?: boolean;
}

/** Legger det ekte produktbildet uendret (proporsjonalt skalert) oppå en bakgrunn. */
export async function compositeProduct(background: Buffer, productPhoto: Buffer, opts: CompositeOptions): Promise<Buffer> {
  const { width, height } = IMAGE_FORMATS[opts.format];
  const scale = Math.min(0.85, Math.max(0.3, opts.scale ?? 0.6));
  const bg = await sharp(background).rotate().resize(width, height, { fit: "cover" }).toBuffer();

  const box = Math.round(Math.min(width, height) * scale);
  const product = await sharp(productPhoto).rotate().resize(box, box, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  const pw = product.info.width;
  const ph = product.info.height;

  let left = Math.round((width - pw) / 2);
  let top = Math.round((height - ph) / 2);
  const margin = Math.round(Math.min(width, height) * 0.07);
  if (opts.position === "bottom") top = height - ph - margin;
  if (opts.position === "left") left = margin;
  if (opts.position === "right") left = width - pw - margin;

  const layers: OverlayOptions[] = [];
  if (opts.shadow !== false) {
    const blur = Math.max(8, Math.round(box * 0.04));
    const pad = blur * 3;
    const shadowSvg = Buffer.from(
      `<svg width="${pw + pad * 2}" height="${ph + pad * 2}" xmlns="http://www.w3.org/2000/svg"><rect x="${pad}" y="${pad + Math.round(blur * 0.8)}" width="${pw}" height="${ph}" rx="4" fill="rgba(40,28,18,0.35)"/></svg>`,
    );
    const shadow = await sharp(shadowSvg).blur(blur).png().toBuffer();
    layers.push({ input: shadow, left: Math.max(0, left - pad), top: Math.max(0, top - pad) });
  }
  layers.push({ input: product.data, left, top });

  return sharp(bg).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[.,;:!?]?$/, "")}…`;
    return kept;
  }
  return lines;
}

export interface TextGraphicOptions {
  format: ImageFormat;
  headline: string;
  subline?: string;
  theme?: "light" | "dark" | "wood";
  /** Valgfritt bakgrunnsbilde; ellers brukes en rolig farget bakgrunn. */
  background?: Buffer;
}

const THEMES = {
  light: { bg: "#FAF7F2", text: "#2B2420", accent: "#A0703F", overlay: "rgba(250,247,242,0.82)" },
  dark: { bg: "#3A281B", text: "#FAF7F2", accent: "#E0CBAE", overlay: "rgba(43,36,32,0.62)" },
  wood: { bg: "#EFE4D4", text: "#3A281B", accent: "#6B472A", overlay: "rgba(239,228,212,0.85)" },
} as const;

/** Grafikk med tekst – tekst tegnes av oss, ikke av AI, så den alltid blir riktig stavet. */
export async function textGraphic(opts: TextGraphicOptions): Promise<Buffer> {
  const { width, height } = IMAGE_FORMATS[opts.format];
  const t = THEMES[opts.theme ?? "light"];
  const base = opts.background
    ? await sharp(opts.background).rotate().resize(width, height, { fit: "cover" }).toBuffer()
    : await sharp({ create: { width, height, channels: 3, background: t.bg } }).png().toBuffer();

  const headSize = Math.round(width * (opts.format === "landscape" ? 0.058 : 0.072));
  const subSize = Math.round(headSize * 0.42);
  const maxChars = Math.max(10, Math.floor((width * 0.8) / (headSize * 0.52)));
  const head = wrapText(opts.headline, maxChars, 4);
  const sub = opts.subline ? wrapText(opts.subline, Math.floor(maxChars * 1.9), 3) : [];
  const blockH = head.length * headSize * 1.15 + (sub.length ? subSize * 1.5 * sub.length + headSize * 0.6 : 0);
  const panelPad = Math.round(width * 0.06);
  const panelH = Math.round(blockH + panelPad * 2 + 24);
  const panelY = Math.round(height - panelH - height * 0.06);
  const panelX = Math.round(width * 0.06);
  const panelW = width - panelX * 2;
  let y = panelY + panelPad + headSize;
  const headTs = head.map((l, i) => `<tspan x="${panelX + panelPad}" y="${y + i * headSize * 1.15}">${escapeXml(l)}</tspan>`).join("");
  y += (head.length - 1) * headSize * 1.15 + headSize * 0.6 + subSize * 1.2;
  const subTs = sub.map((l, i) => `<tspan x="${panelX + panelPad}" y="${y + i * subSize * 1.5}">${escapeXml(l)}</tspan>`).join("");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="28" fill="${opts.background ? t.overlay : "transparent"}"/>
  <rect x="${panelX + panelPad}" y="${panelY + panelPad - 18}" width="56" height="4" rx="2" fill="${t.accent}"/>
  <text font-family="Georgia, 'DejaVu Serif', serif" font-size="${headSize}" font-weight="600" fill="${t.text}">${headTs}</text>
  <text font-family="'Helvetica Neue', Arial, 'DejaVu Sans', sans-serif" font-size="${subSize}" fill="${t.text}" opacity="0.85">${subTs}</text>
</svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Ledetekst til bildegeneratoren for bakgrunn UTEN produkt. */
export function backgroundPrompt(scene: string, format: ImageFormat): string {
  return [
    `Fotorealistisk interiørbakgrunn for et produktbilde: ${scene}.`,
    "Skandinavisk, lyst og varmt, naturlige materialer og tretoner, mykt dagslys.",
    "Bildet skal IKKE inneholde noe produkt, ingen fliser, rammer, bilder, tekst, logoer eller mennesker.",
    "La det være en tom, rolig flate i midten der et produkt kan plasseres senere.",
    format === "landscape" ? "Bredt format." : format === "portrait" ? "Stående format." : "Kvadratisk format.",
  ].join(" ");
}
