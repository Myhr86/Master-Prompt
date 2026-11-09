import { ZodError } from "zod";
import { AuthError } from "./auth";
import { RateLimitError } from "./security";
import { log } from "./logger";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string };

/** Oversetter feil til trygge, norske meldinger uten interne detaljer. */
export function toActionError(err: unknown, context: string): { ok: false; error: string } {
  if (err instanceof AuthError) return { ok: false, error: "Du må være innlogget som eier." };
  if (err instanceof RateLimitError) return { ok: false, error: err.message };
  if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? "Ugyldige data" };
  if (err instanceof UserFacingError) return { ok: false, error: err.message };
  // Feilmeldinger fra databasens regler (P0001) er skrevet på norsk og er trygge å vise.
  const pg = err as { code?: string; message?: string };
  if (pg?.code === "P0001" && pg.message) return { ok: false, error: pg.message };
  log.error(`action.${context}.failed`, { error: err });
  return { ok: false, error: "Noe gikk galt. Prøv igjen, eller sjekk loggen." };
}

/** Feil med en melding som er ment for eieren. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
