import { z } from "zod";
import type { StructuredCaller } from "./claude";
import { POST_TYPES } from "./schemas";

/** Anslår innleggstype for innlegg publisert utenom appen (kun tekst – billig). */
const ClassificationSchema = z.object({
  items: z.array(z.object({ id: z.string(), post_type: z.enum(POST_TYPES) })),
});

export async function classifyPostTypes(posts: { id: string; text: string }[], call: StructuredCaller, model?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!posts.length) return out;
  const res = await call({
    system:
      "Du klassifiserer Facebook-innlegg fra en norsk småbedrift (personlige, lasergraverte produkter i tre og keramikk) etter innleggstype. Velg den typen som best beskriver hovedformålet med innlegget.",
    user: `Typer: ${POST_TYPES.join(", ")}.\n\nInnlegg:\n${JSON.stringify(posts.map((p) => ({ id: p.id, tekst: p.text.slice(0, 500) })), null, 1)}`,
    schema: ClassificationSchema,
    model,
    effort: "low",
    maxTokens: 4000,
  });
  const ids = new Set(posts.map((p) => p.id));
  for (const it of res.data.items) if (ids.has(it.id)) out.set(it.id, it.post_type);
  return out;
}
