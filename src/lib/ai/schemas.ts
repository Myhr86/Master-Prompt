import { z } from "zod";

export const POST_TYPES = [
  "produktpresentasjon",
  "gaveide",
  "sesongkampanje",
  "handverk",
  "bak_kulissene",
  "engasjement",
  "konkurranse",
  "trafikk_nettbutikk",
  "personlig_produkt",
  "hoytid_merkedag",
] as const;

export const POST_TYPE_LABEL: Record<(typeof POST_TYPES)[number], string> = {
  produktpresentasjon: "Produktpresentasjon",
  gaveide: "Gaveidé",
  sesongkampanje: "Sesongkampanje",
  handverk: "Håndverk",
  bak_kulissene: "Bak kulissene",
  engasjement: "Spørsmål til følgerne",
  konkurranse: "Konkurranseforslag",
  trafikk_nettbutikk: "Trafikk til nettbutikken",
  personlig_produkt: "Personlige produkter",
  hoytid_merkedag: "Høytid / merkedag",
};

const score = z.number().int().min(1).max(5);

/** Strukturert svar fra Claude. Valideres både av API-et og av Zod. */
export const GeneratedPostSchema = z.object({
  post_type: z.enum(POST_TYPES),
  title: z.string().describe("Innledende setning / overskrift, maks ca. 90 tegn"),
  body: z.string().describe("Brødtekst på naturlig norsk bokmål"),
  call_to_action: z.string().describe("Kort, naturlig handlingsoppfordring"),
  link_url: z.string().nullable().describe("Lenke til nettbutikken – kun fra produktbiblioteket eller nettbutikkens forside"),
  product_id: z.string().nullable().describe("ID fra produktbiblioteket, eller null"),
  hashtags: z.array(z.string()).describe("3–6 relevante emneknagger"),
  image_suggestion: z.string().describe("Forslag til bilde. Foretrekk ekte produktbilder."),
  suggested_image_id: z.string().nullable().describe("ID til et eksisterende produktbilde, eller null"),
  suggested_media_id: z.string().nullable().describe("ID til et bilde fra mediebanken (egne bilder fra verkstedet), eller null"),
  recommended_publish_at: z.string().describe("Anbefalt tidspunkt, ISO 8601 med tidssone"),
  rationale: z.string().describe("Kort forklaring på hvorfor innlegget kan fungere"),
  variants: z
    .array(z.object({ title: z.string(), body: z.string() }))
    .describe("0–2 alternative tekstvarianter"),
  needs_verification: z
    .array(z.string())
    .describe("Påstander i teksten som eieren må bekrefte (f.eks. leveringstid). Tom liste hvis ingen."),
  quality: z.object({
    relevance: score,
    language: score,
    originality: score,
    product_accuracy: score,
    marketing_value: score,
    visual_quality: score,
    notes: z.string().describe("Kort intern egenvurdering – hva kan bli bedre"),
  }),
});

export const GenerationResultSchema = z.object({
  posts: z.array(GeneratedPostSchema),
  planning_notes: z.string().describe("Kort oppsummering av ukeplanen og variasjonen"),
});

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>;
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

export const RewriteResultSchema = z.object({
  title: z.string(),
  body: z.string(),
  call_to_action: z.string(),
  hashtags: z.array(z.string()),
  rationale: z.string(),
  needs_verification: z.array(z.string()),
});
export type RewriteResult = z.infer<typeof RewriteResultSchema>;

export const AnalysisResultSchema = z.object({
  summary: z.string(),
  best_post_types: z.array(z.object({ post_type: z.string(), evidence: z.string() })),
  product_interest: z.array(z.object({ product: z.string(), evidence: z.string() })),
  themes_to_use_more: z.array(z.string()),
  improvements: z.array(z.string()),
  data_limitations: z.string().describe("Hva dataene IKKE kan si noe om"),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
