import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOwnerPage } from "@/lib/auth";
import { readOAuthCookie } from "@/lib/facebook/oauth-cookie";
import { graphClient } from "@/lib/facebook/connection";
import { Card, Notice, PageHeader } from "@/components/ui";
import { PagePicker } from "./page-picker";

export const metadata: Metadata = { title: "Velg Facebook-side" };

export default async function ChoosePage() {
  await requireOwnerPage();
  const cookie = await readOAuthCookie();
  const graph = graphClient();
  if (!cookie?.userToken || !graph) redirect("/innstillinger?fb=utlopt#facebook");
  let pages: { id: string; name: string; canPost: boolean }[] = [];
  let error: string | null = null;
  try {
    // Kun id og navn sendes til nettleseren – aldri tokens.
    pages = (await graph.listPages(cookie.userToken)).map((p) => ({ id: p.id, name: p.name, canPost: !p.tasks || p.tasks.includes("CREATE_CONTENT") }));
  } catch {
    error = "Kunne ikke hente sidene dine fra Facebook.";
  }
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Facebook" title="Velg side" subtitle="Velg Myhr Tre og Design-siden og bekreft tilkoblingen." />
      {error && <Notice tone="error">{error}</Notice>}
      <Card className="p-5">
        {pages.length === 0 && !error ? <p className="text-sm text-ink-soft">Fant ingen sider. Sjekk at du ga appen tilgang til siden hos Facebook.</p> : <PagePicker pages={pages} />}
      </Card>
    </div>
  );
}
