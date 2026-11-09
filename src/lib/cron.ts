import "server-only";
import { env } from "./env";
import { safeEqual } from "./crypto";

/** Vercel Cron sender "Authorization: Bearer <CRON_SECRET>". */
export function isAuthorizedCron(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env().CRON_SECRET}`;
  return header.length === expected.length && safeEqual(header, expected);
}
