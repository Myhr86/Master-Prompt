import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { env } from "./env";

export class AuthError extends Error {
  constructor(message = "Ikke autorisert") {
    super(message);
    this.name = "AuthError";
  }
}

export interface Owner {
  id: string;
  email: string;
}

/**
 * Bekrefter at forespørselen kommer fra en innlogget, autorisert eier.
 * To uavhengige kontroller: e-post i OWNER_EMAILS OG rad i public.users
 * (som RLS-policyene bygger på).
 */
export async function getOwner(): Promise<Owner | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;
  const email = data.user.email.toLowerCase();
  if (!env().OWNER_EMAILS.includes(email)) return null;
  const { data: row } = await supabase.from("users").select("id, email").eq("id", data.user.id).maybeSingle();
  if (!row) return null;
  return { id: data.user.id, email };
}

/** For sider: send til innlogging hvis ikke autorisert. */
export async function requireOwnerPage(): Promise<Owner> {
  const owner = await getOwner();
  if (!owner) redirect("/login");
  return owner;
}

/** For Server Actions og API-ruter: kast feil hvis ikke autorisert. */
export async function requireOwner(): Promise<Owner> {
  const owner = await getOwner();
  if (!owner) throw new AuthError();
  return owner;
}
