import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOwnerPage } from "@/lib/auth";
import { readOAuthCookie } from "@/lib/facebook/oauth-cookie";
import { graphClient } from "@/lib/facebook/connection";
import { env } from "@/lib/env";
import { Card, Notice, PageHeader } from "@/components/ui";
import { PagePicker } from "./page-picker";
import { Button } from "@/components/ui";

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
    pages = (await graph.accessiblePages(cookie.userToken)).map((p) => ({ id: p.id, name: p.name, canPost: !p.tasks || p.tasks.includes("CREATE_CONTENT") }));
  } catch (e) {
    error = `Kunne ikke hente sidene dine fra Facebook: ${(e as Error).message}`;
  }
  const diagnosis = pages.length === 0 ? await graph.diagnose(cookie.userToken) : null;
  const loginMethod = env().META_LOGIN_CONFIG_ID ? "Facebook Login for Business (konfigurasjons-ID)" : "Facebook Login (scope)";
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Facebook" title="Velg side" subtitle="Velg Myhr Tre og Design-siden og bekreft tilkoblingen." />
      {error && <Notice tone="error">{error}</Notice>}
      <Card className="p-5">
        {pages.length === 0 && !error ? <NoPages /> : <PagePicker pages={pages} />}
      </Card>
      {diagnosis && (
        <Card className="mt-4 p-5">
          <h2 className="text-lg">Feilsøking</h2>
          <p className="mt-1 text-xs text-ink-mute">Dette er det Facebook svarte. Ingen tokens vises. Du kan kopiere teksten og sende den videre.</p>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-wood-50 p-3 text-xs text-ink">
            {[
              `Innlogget som: ${diagnosis.userName ?? "ukjent"}`,
              `Innloggingsmetode: ${loginMethod}`,
              `Tokentype: ${diagnosis.tokenType ?? "ukjent"}`,
              `Gitte tillatelser: ${diagnosis.granted.join(", ") || "ingen"}`,
              `Avslåtte tillatelser: ${diagnosis.declined.join(", ") || "ingen"}`,
              `Valgte sider per tillatelse: ${Object.entries(diagnosis.selectedPagesPerScope).map(([k, v]) => `${k}=${v < 0 ? "alle" : v}`).join(", ") || "ingen oppgitt"}`,
              `Sider i /me/accounts: ${diagnosis.accountsCount ?? "feil"}${diagnosis.accountsError ? ` (${diagnosis.accountsError})` : ""}`,
              ...diagnosis.selectedPages.map((p) => `Valgt side ${p.id}: ${p.result}`),
            ].join("\n")}
          </pre>
        </Card>
      )}
    </div>
  );
}

function NoPages() {
  return (
    <div className="flex flex-col gap-3 text-sm text-ink-soft">
      <p className="font-medium text-ink">Facebook ga ikke appen tilgang til noen sider.</p>
      <ol className="ml-5 list-decimal space-y-1.5">
        <li>
          Trykk <span className="font-medium text-ink">Koble til på nytt</span>. I Facebook-vinduet velger du <span className="font-medium text-ink">Rediger innstillinger / Velg sider</span> (eller «Opt in to current Pages only») og huker av <span className="font-medium text-ink">Myhr Tre og Design</span>.
        </li>
        <li>Sjekk at du er logget inn på Facebook med kontoen som administrerer siden (full kontroll / «Facebook-tilgang» med alle rettigheter).</li>
        <li>Eies siden av en Meta Business-konto: gå til Meta Business Suite → Innstillinger → Personer, og gi din personlige konto full kontroll over siden.</li>
        <li>
          Hvis du allerede har koblet til før: gå til Facebook → Innstillinger og personvern → Innstillinger → <span className="font-medium text-ink">Bedriftsintegrasjoner</span>, fjern appen, og koble til på nytt.
        </li>
      </ol>
      <form action="/api/facebook/login" method="post">
        <Button type="submit">Koble til på nytt</Button>
      </form>
    </div>
  );
}
