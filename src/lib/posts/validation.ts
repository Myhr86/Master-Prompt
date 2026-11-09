import { z } from "zod";

const httpsUrl = z
  .string()
  .trim()
  .url("Ugyldig lenke")
  .refine((u) => u.startsWith("https://"), "Lenken må starte med https://");

export const hashtagSchema = z
  .string()
  .trim()
  .transform((t) => (t.startsWith("#") ? t : `#${t}`))
  .refine((t) => /^#[\p{L}\p{N}_]{1,60}$/u.test(t), "Emneknagger kan bare inneholde bokstaver, tall og _");

/** Tolker emneknagger fra fritekst ("#a #b, c") */
export function parseHashtags(input: string): string[] {
  const raw = input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const r of raw) {
    const parsed = hashtagSchema.safeParse(r);
    if (parsed.success && !out.includes(parsed.data)) out.push(parsed.data);
  }
  return out.slice(0, 30);
}

export const postEditSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(300, "Overskriften er for lang"),
  content: z.string().trim().min(1, "Teksten kan ikke være tom").max(10000, "Teksten er for lang"),
  hashtags: z.array(hashtagSchema).max(30),
  link_url: z.union([httpsUrl, z.literal("")]).transform((v) => (v === "" ? null : v)),
  product_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
});

export const scheduleSchema = z.object({
  id: z.string().uuid(),
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .refine((d) => new Date(d).getTime() > Date.now() + 60_000, "Tidspunktet må være minst ett minutt fram i tid"),
});

export const moveSchema = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const uuidSchema = z.string().uuid();
