/**
 * Konkurranser på Facebook-siden.
 *
 * Vilkårene skrives deterministisk her (ikke av AI), slik at de alltid
 * inneholder det Facebook og norsk markedsføringsrett krever: hvem kan delta,
 * hvordan, frist, premie, trekning, kunngjøring, at det er gratis, og at
 * Facebook/Meta ikke står bak.
 */
export interface ContestInput {
  title: string;
  prize: string;
  question: string | null;
  entry_method: "kommentar" | "kommentar_like";
  min_age: number;
  region: string;
  starts_at: string;
  ends_at: string;
  announce_at: string;
  winner_count: number;
  delivery_note: string | null;
  business_name: string;
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export const META_DISCLAIMER = "Konkurransen er ikke sponset, støttet, administrert av eller tilknyttet Facebook eller Meta.";

export function entryInstruction(c: Pick<ContestInput, "entry_method" | "question">): string {
  const answer = c.question ? `svar på spørsmålet («${c.question}») i kommentarfeltet` : "legg igjen en kommentar";
  return c.entry_method === "kommentar_like" ? `Lik dette innlegget og ${answer}` : `${answer.charAt(0).toUpperCase()}${answer.slice(1)}`;
}

export function buildRulesText(c: ContestInput): string {
  const winners = c.winner_count === 1 ? "én vinner" : `${c.winner_count} vinnere`;
  return [
    "Vilkår:",
    `• Slik deltar du: ${entryInstruction(c)}. Én deltakelse per person.`,
    `• Frist: ${fmt(c.ends_at)}.`,
    `• Premie: ${c.prize}.${c.delivery_note ? ` ${c.delivery_note}` : ""}`,
    `• Vi trekker ${winners} tilfeldig blant gyldige deltakere. Vinneren kunngjøres her ${fmt(c.announce_at)} og kontaktes via Facebook.`,
    `• Gratis å delta, uten kjøpskrav. Åpen for personer over ${c.min_age} år bosatt i ${c.region}.`,
    `• Arrangør: ${c.business_name}. Vi bruker kun navnet ditt til å gjennomføre konkurransen.`,
    `• ${META_DISCLAIMER}`,
  ].join("\n");
}

/** Formuleringer Facebook ikke tillater som betingelse for å delta. */
const FORBIDDEN: { re: RegExp; message: string }[] = [
  { re: /\bdel\b[^.\n]{0,40}\b(innlegget|posten|dette|på (din|egen) (tidslinje|vegg|side))/i, message: "Facebook tillater ikke at deling er en betingelse for å delta («del innlegget»)." },
  { re: /\bdel(e)? for (en )?(ekstra|flere) (lodd|sjanse)/i, message: "Ekstra lodd for deling er ikke tillatt på Facebook." },
  { re: /\b(tagg|tag|nevn|merk)\b[^.\n]{0,30}\b(venn|venner|en du|noen)/i, message: "Facebook tillater ikke at du må tagge/nevne venner for å delta." },
  { re: /\b(kjøp|handle|bestill)\b[^.\n]{0,40}\bfor å (delta|være med)/i, message: "Kjøpskrav gjør konkurransen til noe annet juridisk – hold den gratis." },
];

export function contestCompliance(text: string): string[] {
  const out: string[] = [];
  for (const f of FORBIDDEN) if (f.re.test(text)) out.push(f.message);
  if (!text.includes(META_DISCLAIMER)) out.push("Teksten mangler erklæringen om at konkurransen ikke er knyttet til Facebook/Meta.");
  return out;
}

/** Kort tekst til påminnelsesinnlegget: hvordan delta, frist og erklæringen. */
export function buildReminderFooter(c: ContestInput): string {
  return [`Slik deltar du: ${entryInstruction(c)}.`, `Frist: ${fmt(c.ends_at)}.`, "Fullstendige vilkår står i konkurranseinnlegget.", META_DISCLAIMER].join("\n");
}

export const WINNER_PLACEHOLDER = "[VINNER]";
