import type { BusinessSettings, Product } from "../types";

/**
 * Systeminstruks for Claude som markedsføringsansvarlig.
 * Holdes STABIL (ingen datoer eller variabler) slik at prompt caching fungerer.
 * Alt som varierer sendes i brukermeldingen.
 */
export const MARKETING_SYSTEM_PROMPT = `Du er markedsføringsansvarlig for Myhr Tre og Design, en norsk småbedrift som lager personlige produkter og interiør – blant annet personlige keramiske familiefliser med kundens egne bilder, lasergraverte produkter og produkter i tre og design. Du skriver Facebook-innlegg på norsk bokmål for bedriftens side.

Slik jobber du:
- Tenk kommersielt og forstå norsk kjøpsatferd: nordmenn reagerer godt på ekthet, nøkternhet, omtanke og kvalitet, og dårlig på masete salgsspråk.
- Prioriter trafikk til nettbutikken, men variér mellom salg, inspirasjon, historiefortelling, håndverk og engasjement. Ikke alle innlegg skal være direkte reklame.
- Skriv varmt, personlig og naturlig – som et menneske i bedriften, ikke som en maskin. Variér setningslengde, åpninger og struktur mellom innleggene. Gjenta ikke formuleringer fra tidligere innlegg.
- Bruk få emojier (0–2 per innlegg) og 3–6 relevante emneknagger.
- Fremhev personlighet, gode gaveideer, familie og minner, håndverk, kvalitet, norsk småbedrift og unike produkter der det passer.

Sannhet og nøyaktighet – absolutte regler:
- Produktbiblioteket du får er den ENESTE sannhetskilden om produkter. Bruk kun navn, beskrivelser, priser og lenker derfra.
- Finn aldri på priser, rabatter, tilbud, egenskaper, materialer, mål, leveringstider, frister eller garantier. Nevn bare pris hvis den står i biblioteket, og da nøyaktig.
- Skap aldri falsk knapphet ("bare noen få igjen") eller falske tidsfrister.
- Finn aldri på kundeuttalelser, anmeldelser, sitater eller antall fornøyde kunder.
- Hvis et innlegg trenger en opplysning som ikke finnes i biblioteket (for eksempel siste bestillingsdag før jul), formuler teksten uten den eller legg påstanden i "needs_verification" slik at eieren kan bekrefte.
- Konkurranser er kun FORSLAG. Skriv dem slik at eieren må fylle inn premie, varighet og regler, og legg dette i "needs_verification". Følg Metas retningslinjer (ikke be folk dele på egen tidslinje eller tagge venner som betingelse for å delta).
- Lenker skal kun være produktlenker fra biblioteket eller nettbutikkens adresse. Ikke lag nye URL-er.
- Bilder: foreslå ekte produktbilder fra biblioteket når de finnes (bruk suggested_image_id). Ikke foreslå at AI-genererte bilder presenteres som fotografier av ekte kundeprodukter.

Egenkontroll før du svarer:
For hvert innlegg: skriv et utkast, les det kritisk som en erfaren norsk tekstforfatter, og forbedre det. Gi deretter en ærlig intern vurdering (1–5) av relevans, språk, originalitet, produktkorrekthet, markedsføringsverdi og visuell kvalitet. Vurderingen er et internt arbeidsverktøy, ikke en garanti for resultater – vær nøktern.

Du kan aldri godkjenne eller publisere innlegg. Alt du lager er forslag som eieren vurderer.`;

export interface GenerationContext {
  settings: BusinessSettings;
  products: Product[];
  productImages: { id: string; product_id: string; image_type: string; alt_text: string | null }[];
  recentPosts: { title: string; content: string; post_type: string | null; status: string; published_at: string | null; created_at: string }[];
  slots: { iso: string; weekday: string; theme: string | null }[];
  seasonalEvents: { name: string; date: string; angle: string }[];
  focus?: { postTypes?: string[]; productIds?: string[]; instructions?: string };
  now: Date;
}

function trim(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function buildGenerationPrompt(ctx: GenerationContext): string {
  const { settings } = ctx;
  const priority = new Set(settings.prioritized_product_ids);
  const products = ctx.products
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      navn: p.name,
      beskrivelse: trim(p.description, 1200),
      pris: p.price === null ? "IKKE OPPGITT – ikke nevn pris" : `${p.price} ${p.currency}`,
      lenke: p.product_url,
      prioritert: priority.has(p.id),
      maa_bekreftes: p.needs_verification ? p.verification_note ?? "Opplysningene er ikke bekreftet" : undefined,
      bilder: ctx.productImages.filter((i) => i.product_id === p.id).map((i) => ({ id: i.id, type: i.image_type, beskrivelse: i.alt_text })),
    }));

  const history = ctx.recentPosts.map((p) => ({
    type: p.post_type,
    status: p.status,
    dato: p.published_at ?? p.created_at,
    overskrift: trim(p.title, 120),
    utdrag: trim(p.content, 280),
  }));

  return `Dagens dato og tid: ${ctx.now.toISOString()} (tidssone ${settings.timezone}).

BEDRIFT
Navn: ${settings.business_name}
Nettbutikk: ${settings.website}
Språk: ${settings.language}
Skrivestil fra eieren: ${settings.brand_voice}
Faste emneknagger som kan brukes: ${settings.default_hashtags.join(" ") || "(ingen)"}

OPPGAVE
Lag ${ctx.slots.length} forskjellige Facebook-innlegg, ett for hvert av disse publiseringstidspunktene:
${ctx.slots.map((s, i) => `${i + 1}. ${s.iso} (${s.weekday})${s.theme ? ` – ukens tema: ${s.theme}` : ""}`).join("\n")}

Bruk tidspunktene over som "recommended_publish_at" (du kan justere klokkeslettet hvis du har en god grunn, men behold dagen).
${ctx.focus?.postTypes?.length ? `Eieren ønsker særlig disse innleggstypene: ${ctx.focus.postTypes.join(", ")}.` : "Velg en god variasjon av innleggstyper."}
${ctx.focus?.productIds?.length ? `Eieren ønsker fokus på disse produkt-ID-ene: ${ctx.focus.productIds.join(", ")}.` : ""}
${ctx.focus?.instructions ? `Ekstra instruksjoner fra eieren (følg dem så lenge de ikke bryter sannhetsreglene):\n"""${trim(ctx.focus.instructions, 1500)}"""` : ""}

AKTUELLE HØYTIDER OG SESONGER (bruk når det er naturlig – ikke anta at noen kampanje eller rabatt er aktiv)
${ctx.seasonalEvents.length ? ctx.seasonalEvents.map((e) => `- ${e.name} (${e.date}): ${e.angle}`).join("\n") : "- Ingen spesielle i perioden"}

PRODUKTBIBLIOTEK (eneste sannhetskilde)
${products.length ? JSON.stringify(products, null, 1) : "Biblioteket er tomt. Lag innlegg om bedriften, håndverket og nettbutikken generelt uten å nevne konkrete produkter, priser eller egenskaper. Lenk til nettbutikkens forside."}

TIDLIGERE INNLEGG (unngå gjentakelser i tema, åpning og formuleringer)
${history.length ? JSON.stringify(history, null, 1) : "Ingen tidligere innlegg."}`;
}

export function buildRewritePrompt(input: {
  settings: BusinessSettings;
  product: Product | null;
  current: { title: string; content: string; hashtags: string[] };
  instructions: string;
}): string {
  return `Skriv om dette Facebook-innlegget for ${input.settings.business_name}.

Skrivestil: ${input.settings.brand_voice}

NÅVÆRENDE INNLEGG
Overskrift: ${input.current.title}
Tekst:
${input.current.content}
Emneknagger: ${input.current.hashtags.join(" ")}

PRODUKT (eneste sannhetskilde)
${input.product ? JSON.stringify({ navn: input.product.name, beskrivelse: input.product.description, pris: input.product.price === null ? "ikke oppgitt" : `${input.product.price} ${input.product.currency}`, lenke: input.product.product_url }) : "Ingen produkt knyttet til innlegget – ikke nevn konkrete produktegenskaper eller priser."}

ØNSKER FRA EIEREN
${input.instructions.trim() || "Lag en frisk, ny versjon med en annen vinkel og åpning."}`;
}

export function buildAnalysisPrompt(data: unknown): string {
  return `Analyser resultatene for Facebook-innleggene til Myhr Tre og Design. Bruk KUN dataene under. Hvis datagrunnlaget er lite, si det tydelig og ikke trekk sterke konklusjoner. Ikke finn på tall.

DATA
${JSON.stringify(data, null, 1)}`;
}
