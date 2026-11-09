import { z } from "zod";
import type { StructuredCaller } from "../ai/claude";

/**
 * Gjennomgang av Facebook-siden: Claude vurderer sideinformasjon og
 * innleggsstatistikk og gir en prioritert, konkret forbedringsliste.
 */
export const REVIEW_AREAS = [
  "profilbilde",
  "coverbilde",
  "navn_brukernavn",
  "kategori",
  "beskrivelse",
  "nettside",
  "kontaktinfo",
  "handlingsknapp",
  "apningstider_sted",
  "innleggsfrekvens",
  "innholdsmiks",
  "video_reels",
  "engasjement",
  "anmeldelser",
  "butikk",
  "annet",
] as const;

export const REVIEW_AREA_LABEL: Record<(typeof REVIEW_AREAS)[number], string> = {
  profilbilde: "Profilbilde",
  coverbilde: "Coverbilde",
  navn_brukernavn: "Navn og brukernavn",
  kategori: "Kategori",
  beskrivelse: "Intro / beskrivelse",
  nettside: "Lenke til nettbutikken",
  kontaktinfo: "Kontaktinformasjon",
  handlingsknapp: "Handlingsknapp",
  apningstider_sted: "Åpningstider og sted",
  innleggsfrekvens: "Hvor ofte du poster",
  innholdsmiks: "Innholdsmiks",
  video_reels: "Video og Reels",
  engasjement: "Engasjement",
  anmeldelser: "Anbefalinger",
  butikk: "Butikk på Facebook",
  annet: "Annet",
};

export const STATUS_LABEL = { bra: "Bra", kan_forbedres: "Kan forbedres", mangler: "Mangler", kunne_ikke_sjekkes: "Kunne ikke sjekkes" } as const;
export const PRIORITY_LABEL = { hoy: "Høy", middels: "Middels", lav: "Lav" } as const;

export const ReviewSchema = z.object({
  summary: z.string().describe("3–5 setninger: helhetsinntrykk og det viktigste å gjøre først"),
  strengths: z.array(z.string()).describe("Det som allerede fungerer bra (2–5 punkter)"),
  items: z.array(
    z.object({
      area: z.enum(REVIEW_AREAS),
      status: z.enum(["bra", "kan_forbedres", "mangler", "kunne_ikke_sjekkes"]),
      priority: z.enum(["hoy", "middels", "lav"]),
      finding: z.string().describe("Hva du fant – kun basert på dataene"),
      action: z.string().describe("Konkret tiltak, kort"),
      where: z.string().describe("Hvor på Facebook eieren gjør endringen (f.eks. «Siden → Rediger → Intro»)"),
      suggested_text: z.string().nullable().describe("Ferdig tekst eieren kan lime inn, eller null"),
    }),
  ),
  suggested_bio: z.string().nullable().describe("Forslag til kort intro/bio, maks 101 tegn"),
  suggested_description: z.string().nullable().describe("Forslag til lengre beskrivelse (2–4 setninger), eller null"),
  cover_idea: z.string().nullable().describe("Konkret idé til coverbilde som viser ekte produkter, eller null"),
});
export type PageReview = z.infer<typeof ReviewSchema>;
export type ReviewItem = PageReview["items"][number] & { done?: boolean };
/** Lagret gjennomgang: punktene kan markeres som gjort. */
export type ReviewDoc = Omit<PageReview, "items"> & { items: ReviewItem[] };

export const PAGE_REVIEW_SYSTEM = `Du er en erfaren norsk rådgiver i sosiale medier som gjennomgår Facebook-siden til Myhr Tre og Design, en norsk småbedrift som lager personlige, lasergraverte produkter i tre, keramikk og akryl og selger dem i en nettbutikk.

Målet: flere følgere, mer engasjement og mer trafikk til nettbutikken – med en ekte, personlig tone.

Regler:
- Bygg KUN på dataene du får. Felt som står under "ikke_tilgjengelig" eller mangler i dataene skal få status "kunne_ikke_sjekkes" – ikke anta at de mangler på siden.
- Ikke finn på tall, priser, åpningstider, adresser, anmeldelser eller fakta om bedriften. Tekstforslag skal bare bruke opplysninger fra dataene.
- Vær konkret: hvert tiltak skal kunne gjøres på under 10 minutter, og si hvor på Facebook det gjøres.
- Prioriter det som gir mest effekt for en liten gave-/interiørbedrift (tydelig intro, lenke til nettbutikken, handlingsknapp «Handle nå», jevnlige innlegg, video/Reels).
- Facebook-sidens intro (bio) er maks 101 tegn.
- Skriv på norsk bokmål, vennlig og nøkternt. Ingen garantier om resultater.`;

export async function analyzePage(
  snapshot: unknown,
  images: { mediaType: "image/jpeg"; base64: string; label: string }[],
  call: StructuredCaller,
  model?: string,
): Promise<{ review: ReviewDoc; model: string }> {
  const res = await call({
    system: PAGE_REVIEW_SYSTEM,
    user: `Gjør en gjennomgang av Facebook-siden.${images.length ? ` Bildene er: ${images.map((i, n) => `${n + 1}) ${i.label}`).join(", ")}.` : " Profil- og coverbilde var ikke tilgjengelige."}

DATA
${JSON.stringify(snapshot, null, 1)}`,
    images: images.map((i) => ({ mediaType: i.mediaType, base64: i.base64 })),
    schema: ReviewSchema,
    model,
    effort: "high",
    maxTokens: 12000,
  });
  const order = { hoy: 0, middels: 1, lav: 2 } as const;
  const statusOrder = { mangler: 0, kan_forbedres: 1, kunne_ikke_sjekkes: 2, bra: 3 } as const;
  const items = [...res.data.items]
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || order[a.priority] - order[b.priority])
    .map((i) => ({ ...i, done: false }));
  const bio = res.data.suggested_bio ? res.data.suggested_bio.trim().slice(0, 101) : null;
  return { review: { ...res.data, suggested_bio: bio, items }, model: res.model };
}
