import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

/**
 * Supabase-klient med brukerens sesjon. Alle spørringer går gjennom
 * Row Level Security, slik at kun autorisert eier får tilgang til data.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Kalt fra en Server Component – sesjonen oppdateres i proxy.ts.
        }
      },
    },
  });
}
