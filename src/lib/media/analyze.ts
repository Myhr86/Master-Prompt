import sharp from "sharp";
import { z } from "zod";
import type { StructuredCaller } from "../ai/claude";

/**
 * Bildebeskrivelse for mediebanken. Hvert bilde analyseres ÉN gang ved
 * opplasting; senere bruker Claude bare tekstbeskrivelsen (billig).
 */
export const MEDIA_CATEGORIES = [
  "verksted",
  "gravering",
  "produksjon",
  "ferdig_produkt",
  "produkt_i_hylle",
  "produkt_i_bruk",
  "emballasje",
  "materialer",
  "stemning",
  "annet",
] as const;

export const MEDIA_CATEGORY_LABEL: Record<(typeof MEDIA_CATEGORIES)[number], string> = {
  verksted: "Verksted",
  gravering: "Gravering",
  produksjon: "Produksjon",
  ferdig_produkt: "Ferdig produkt",
  produkt_i_hylle: "Produkt i hylle",
  produkt_i_bruk: "Produkt i bruk",
  emballasje: "Emballasje",
  materialer: "Materialer",
  stemning: "Stemning",
  annet: "Annet",
};

export const MediaAnalysisSchema = z.object({
  description: z.string().describe("1–2 setninger på norsk bokmål som beskriver hva bildet viser, nøkternt og konkret"),
  category: z.enum(MEDIA_CATEGORIES),
  tags: z.array(z.string()).describe("3–8 korte stikkord på norsk, små bokstaver"),
  product_id: z.string().nullable().describe("ID fra produktlisten hvis bildet tydelig viser et av produktene, ellers null"),
  people_visible: z.boolean().describe("true hvis personer eller ansikter er synlige"),
  suitable_for: z.array(z.string()).describe("Hvilke innleggstyper bildet passer til, f.eks. bak_kulissene, handverk, produktpresentasjon"),
  quality_note: z.string().describe("Kort om bildekvalitet (skarphet, lys) – tom streng hvis alt er fint"),
});
export type MediaAnalysis = z.infer<typeof MediaAnalysisSchema>;

export const MEDIA_SYSTEM_PROMPT = `Du hjelper Myhr Tre og Design, en norsk småbedrift som lager lasergraverte og personlige produkter i tre, keramikk og akryl, med å holde orden på egne bilder fra verkstedet. Du beskriver bilder slik at en markedsføringsansvarlig senere kan velge riktig bilde til et Facebook-innlegg uten å se det.

Regler:
- Beskriv bare det som faktisk vises. Ikke gjett på mål, materialer eller priser du ikke kan se.
- Ikke identifiser eller navngi personer. Oppgi bare om personer er synlige.
- Koble bildet til et produkt kun hvis det tydelig er det produktet fra listen.
- Skriv på norsk bokmål.`;

/** Skalerer ned før analyse – sparer tokens (≈1 000–1 600 per bilde). */
export async function prepareForVision(input: Buffer): Promise<string> {
  const out = await sharp(input).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return out.toString("base64");
}

export async function analyzeImage(
  image: Buffer,
  products: { id: string; name: string }[],
  call: StructuredCaller,
  model?: string,
): Promise<MediaAnalysis & { model: string }> {
  const base64 = await prepareForVision(image);
  const productList = products.length ? products.map((p) => `- ${p.id}: ${p.name}`).join("\n") : "(ingen produkter registrert)";
  const res = await call({
    system: MEDIA_SYSTEM_PROMPT,
    user: `Beskriv bildet for mediebanken.\n\nPRODUKTER (bruk ID hvis bildet tydelig viser ett av dem):\n${productList}`,
    images: [{ mediaType: "image/jpeg", base64 }],
    schema: MediaAnalysisSchema,
    model,
    effort: "low",
    maxTokens: 2000,
  });
  const ids = new Set(products.map((p) => p.id));
  const tags = [...new Set(res.data.tags.map((t) => t.trim().toLowerCase()).filter((t) => t && t.length <= 40))].slice(0, 10);
  return {
    ...res.data,
    tags,
    product_id: res.data.product_id && ids.has(res.data.product_id) ? res.data.product_id : null,
    model: res.model,
  };
}
