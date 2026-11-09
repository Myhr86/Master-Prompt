import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

/**
 * Service-rolle-klient. Omgår RLS og skal KUN brukes på serveren for:
 *  - lesing/skriving av krypterte Facebook-tokens
 *  - planlagt publisering (cron) av allerede godkjente innlegg
 *  - signerte URL-er til private bilder
 * Den skal aldri brukes til å godkjenne innlegg.
 */
export function createAdminClient() {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const MEDIA_BUCKET = "media";
