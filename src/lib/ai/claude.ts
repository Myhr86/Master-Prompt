import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../env";
import { UserFacingError } from "../action-result";

/**
 * Tynt lag rundt Anthropic-SDK-et. Claude får KUN tekst om bedriften og
 * produktene – aldri tokens, passord eller andre hemmeligheter.
 */
export interface StructuredCallInput<T extends z.ZodType> {
  system: string;
  user: string;
  schema: T;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  /** Valgfrie bilder (base64) som sendes før teksten, f.eks. for bildebeskrivelse. */
  images?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string }[];
}

export interface StructuredCallOutput<T> {
  data: T;
  model: string;
  usage: unknown;
}

export type StructuredCaller = <T extends z.ZodType>(input: StructuredCallInput<T>) => Promise<StructuredCallOutput<z.infer<T>>>;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new UserFacingError("Claude er ikke konfigurert. Legg inn ANTHROPIC_API_KEY på serveren (se README).");
  client ??= new Anthropic({ apiKey: key, maxRetries: 2, timeout: 280_000 });
  return client;
}

export const callClaudeStructured: StructuredCaller = async (input) => {
  const anthropic = getClient();
  const model = input.model || env().ANTHROPIC_MODEL;
  try {
    const response = await anthropic.beta.messages.parse({
      model,
      max_tokens: input.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      // Ved avslag fra sikkerhetsfilteret prøver API-et en standard reservemodell.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: input.effort ?? "high", format: betaZodOutputFormat(input.schema) },
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: input.images?.length
            ? [
                ...input.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
                { type: "text" as const, text: input.user },
              ]
            : input.user,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new UserFacingError("Claude avslo forespørselen. Prøv å formulere instruksjonene annerledes.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new UserFacingError("Svaret fra Claude ble for langt. Prøv med færre innlegg om gangen.");
    }
    if (!response.parsed_output) {
      throw new UserFacingError("Claude returnerte et svar som ikke kunne tolkes. Prøv igjen.");
    }
    const parsed = input.schema.safeParse(response.parsed_output);
    if (!parsed.success) throw new UserFacingError("Svaret fra Claude hadde ugyldig format. Prøv igjen.");
    return { data: parsed.data, model: response.model, usage: response.usage };
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new UserFacingError("Anthropic-nøkkelen er ugyldig.");
    if (err instanceof Anthropic.RateLimitError) throw new UserFacingError("Claude er midlertidig overbelastet (rate limit). Prøv igjen om litt.");
    if (err instanceof Anthropic.BadRequestError) throw new UserFacingError("Forespørselen til Claude ble avvist (ugyldig forespørsel). Sjekk modellnavnet i innstillingene.");
    if (err instanceof Anthropic.APIConnectionError) throw new UserFacingError("Fikk ikke kontakt med Claude. Prøv igjen.");
    if (err instanceof Anthropic.APIError) throw new UserFacingError("Claude svarte med en feil. Prøv igjen om litt.");
    // Øvrige SDK-feil (f.eks. svar som ikke følger skjemaet).
    if (err instanceof Anthropic.AnthropicError) throw new UserFacingError("Claude returnerte et svar som ikke kunne tolkes. Prøv igjen.");
    throw err;
  }
};
