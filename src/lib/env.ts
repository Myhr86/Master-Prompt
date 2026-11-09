import "server-only";
import { z } from "zod";

/**
 * Server-side miljøvariabler. Ingen av disse sendes noen gang til nettleseren
 * (kun NEXT_PUBLIC_* blir eksponert av Next.js, og de inneholder ingen hemmeligheter).
 *
 * Valgfrie integrasjoner (Anthropic, OpenAI, Meta) gir en tydelig
 * "ikke konfigurert"-status i stedet for å krasje appen.
 */
const optional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  APP_URL: z.string().url(),
  OWNER_EMAILS: z
    .string()
    .min(3)
    .transform((v) => v.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "TOKEN_ENCRYPTION_KEY må være 32 byte base64"),
  CRON_SECRET: z.string().min(32),

  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),

  OPENAI_API_KEY: optional,
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),

  META_APP_ID: optional,
  META_APP_SECRET: optional,
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, "META_GRAPH_API_VERSION må ha formen vNN.N")
    .optional(),
  META_LOGIN_CONFIG_ID: optional,
  META_INSIGHTS_METRICS: z.string().default(""),

  /** "simulated" tvinger testmodus uansett innstilling i databasen. */
  PUBLISH_MODE: z.enum(["live", "simulated"]).default("simulated"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    // Ikke logg verdiene – kun navnene på feltene som mangler/er ugyldige.
    throw new Error(`Ugyldig eller manglende konfigurasjon: ${fields}. Se .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export function integrations() {
  const e = env();
  return {
    anthropic: Boolean(e.ANTHROPIC_API_KEY),
    openaiImages: Boolean(e.OPENAI_API_KEY),
    meta: Boolean(e.META_APP_ID && e.META_APP_SECRET && e.META_GRAPH_API_VERSION),
    livePublishingAllowed: e.PUBLISH_MODE === "live",
  };
}
