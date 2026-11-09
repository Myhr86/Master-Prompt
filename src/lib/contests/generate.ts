import { z } from "zod";
import type { StructuredCaller } from "../ai/claude";
import { MARKETING_SYSTEM_PROMPT } from "../ai/prompts";
import { hashtagSchema } from "../posts/validation";
import { buildReminderFooter, buildRulesText, contestCompliance, WINNER_PLACEHOLDER, type ContestInput } from "./rules";

const PostText = z.object({
  title: z.string().describe("Innledende setning, maks ca. 90 tegn"),
  body: z.string().describe("Brødtekst uten vilkår (vilkårene legges til automatisk)"),
  hashtags: z.array(z.string()),
});

export const ContestTextSchema = z.object({
  announcement: PostText,
  reminder: PostText,
  winner: PostText.describe(`Kunngjøring av vinneren. Bruk nøyaktig ${WINNER_PLACEHOLDER} der vinnerens navn skal stå.`),
});

export interface ContestPostDraft {
  role: "kunngjoring" | "paminnelse" | "vinner";
  title: string;
  content: string;
  hashtags: string[];
  warnings: string[];
}

function tags(list: string[]): string[] {
  return [...new Set(list.map((t) => hashtagSchema.safeParse(t)).filter((r) => r.success).map((r) => r.data as string))].slice(0, 6);
}

/**
 * Lager tekst til konkurransens tre innlegg. Vilkårene og erklæringen om
 * Facebook legges ALLTID til av appen, og alt kontrolleres mot Facebooks regler.
 */
export async function generateContestPosts(
  c: ContestInput,
  product: { name: string; description: string; product_url: string | null } | null,
  call: StructuredCaller,
  model?: string,
): Promise<{ posts: ContestPostDraft[]; model: string }> {
  const res = await call({
    system: MARKETING_SYSTEM_PROMPT,
    user: `Skriv tre Facebook-innlegg for en konkurranse på siden til ${c.business_name}.

KONKURRANSE
Tittel: ${c.title}
Premie: ${c.prize}
${product ? `Produkt (sannhetskilde): ${JSON.stringify({ navn: product.name, beskrivelse: product.description.slice(0, 800) })}` : "Ingen produkt koblet – beskriv bare premien slik den står."}
Spørsmål deltakerne skal svare på: ${c.question ?? "(ingen – de legger igjen en kommentar)"}
Deltakelse: ${c.entry_method === "kommentar_like" ? "liker innlegget og kommenterer" : "kommenterer"}
Antall vinnere: ${c.winner_count}

SKRIV
1. announcement: kunngjøring som skaper lyst til å delta. Varm, personlig, ikke masete. Avslutt med en tydelig oppfordring om å delta.
2. reminder: kort «siste sjanse»-påminnelse dagen før fristen.
3. winner: kunngjøring av vinneren. Skriv ${WINNER_PLACEHOLDER} der navnet skal stå, takk alle som var med.

REGLER (Facebook og norsk lov)
- Ikke skriv vilkår, frister, aldersgrenser eller juridisk tekst – det legges til automatisk.
- Krev ALDRI deling, tagging av venner eller kjøp for å delta. Ikke lov ekstra lodd for deling.
- Ikke finn på premiens verdi, mål eller egenskaper som ikke står over.
- 2–4 emneknagger per innlegg.`,
    schema: ContestTextSchema,
    model,
    effort: "medium",
    maxTokens: 8000,
  });
  const d = res.data;
  const announcement = `${d.announcement.body.trim()}\n\n${buildRulesText(c)}`;
  const reminder = `${d.reminder.body.trim()}\n\n${buildReminderFooter(c)}`;
  let winner = d.winner.body.trim();
  if (!winner.includes(WINNER_PLACEHOLDER)) winner = `Gratulerer, ${WINNER_PLACEHOLDER}! 🎉\n\n${winner}`;

  const posts: ContestPostDraft[] = [
    { role: "kunngjoring", title: d.announcement.title, content: announcement, hashtags: tags(d.announcement.hashtags), warnings: contestCompliance(`${d.announcement.title}\n${announcement}`) },
    { role: "paminnelse", title: d.reminder.title, content: reminder, hashtags: tags(d.reminder.hashtags), warnings: contestCompliance(`${d.reminder.title}\n${reminder}`) },
    {
      role: "vinner",
      title: d.winner.title,
      content: winner,
      hashtags: tags(d.winner.hashtags),
      // Vinnerinnlegget trenger ikke erklæringen, men sjekkes for forbudte formuleringer.
      warnings: [...contestCompliance(`${d.winner.title}\n${winner}`).filter((w) => !w.includes("erklæringen")), "Trekk vinneren under Konkurranser – navnet settes inn automatisk."],
    },
  ];
  return { posts, model: res.model };
}

/** Maler uten AI (når Claude ikke er konfigurert). Eieren skriver selv. */
export function templateContestPosts(c: ContestInput): ContestPostDraft[] {
  const ann = `🎁 Konkurranse: ${c.title}!\n\nVi gir bort ${c.prize}.\n\n${buildRulesText(c)}`;
  const rem = `Siste sjanse til å være med i konkurransen!\n\n${buildReminderFooter(c)}`;
  return [
    { role: "kunngjoring", title: c.title, content: ann, hashtags: ["#konkurranse"], warnings: contestCompliance(ann) },
    { role: "paminnelse", title: "Siste sjanse!", content: rem, hashtags: ["#konkurranse"], warnings: contestCompliance(rem) },
    { role: "vinner", title: "Vi har en vinner!", content: `Gratulerer, ${WINNER_PLACEHOLDER}! Tusen takk til alle som var med.`, hashtags: ["#konkurranse"], warnings: ["Trekk vinneren under Konkurranser – navnet settes inn automatisk."] },
  ];
}
