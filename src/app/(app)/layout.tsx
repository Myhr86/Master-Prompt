import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwnerPage();
  const supabase = await createClient();
  const { count } = await supabase.from("posts").select("id", { count: "exact", head: true }).eq("status", "PENDING_APPROVAL");
  return (
    <div className="min-h-dvh">
      <AppNav email={owner.email} signOut={signOut} pendingCount={count ?? 0} />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pl-72 lg:pr-8 lg:pt-10">{children}</main>
    </div>
  );
}
