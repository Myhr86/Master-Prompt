"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkFacebook, disconnectFacebook, syncFacebookPosts } from "../facebook/actions";
import { Button, Card, Notice } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { FacebookStatus } from "@/lib/types";

const STATUS: Record<string, string> = { connected: "Tilkoblet", expired: "Utløpt", revoked: "Tilbakekalt", error: "Feil" };

export function FacebookPanel({
  status,
  metaConfigured,
  graphVersion,
  pagePosts,
}: {
  status: FacebookStatus | null;
  metaConfigured: boolean;
  graphVersion: string | null;
  pagePosts: { count: number; lastImported: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const needsReconnect = status && status.connection_status !== "connected";

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-[#1877F2]/10 text-[#1877F2]">
          <Icon.facebook />
        </span>
        <div className="flex-1">
          <h2 className="text-lg">Facebook-tilkobling</h2>
          {status ? (
            <p className="text-sm text-ink-soft">
              Side: <span className="font-medium text-ink">{status.page_name}</span> · Status: {STATUS[status.connection_status] ?? status.connection_status}
              {status.token_expires_at ? ` · Token utløper ${new Date(status.token_expires_at).toLocaleDateString("nb-NO")}` : " · Sidetoken uten fast utløpsdato"}
            </p>
          ) : (
            <p className="text-sm text-ink-soft">Ingen side tilkoblet.</p>
          )}
          {status?.last_error && <p className="mt-1 text-xs text-red-700">{status.last_error}</p>}
        </div>
      </div>

      {!metaConfigured && (
        <div className="mt-4">
          <Notice tone="warn" title="Meta-appen er ikke konfigurert">
            Legg inn META_APP_ID, META_APP_SECRET og META_GRAPH_API_VERSION på serveren. Se README, avsnittet «Meta Developer App».
          </Notice>
        </div>
      )}
      {msg && <div className="mt-3"><Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice></div>}

      <div className="mt-4 flex flex-wrap gap-2">
        {/* POST-skjema til egen API-rute (Origin-kontroll), som videresender til Facebook. */}
        <form action="/api/facebook/login" method="post">
          <Button type="submit" disabled={!metaConfigured}>
            <Icon.facebook /> {status ? (needsReconnect ? "Koble til på nytt" : "Bytt side / koble til på nytt") : "Koble til Facebook"}
          </Button>
        </form>
        {status && (
          <>
            <Button variant="secondary" disabled={pending || !metaConfigured} onClick={() => start(async () => { const r = await checkFacebook(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); router.refresh(); })}>
              Test tilkoblingen
            </Button>
            <Button variant="secondary" disabled={pending || !metaConfigured} onClick={() => start(async () => { const r = await syncFacebookPosts(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); router.refresh(); })}>
              {pending ? "Henter …" : "Hent eksisterende innlegg"}
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => confirm("Koble fra Facebook og slette tokenet?") && start(async () => { const r = await disconnectFacebook(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); router.refresh(); })}>
              Koble fra
            </Button>
          </>
        )}
      </div>
      {status && (
        <p className="mt-3 text-sm text-ink-soft">
          {pagePosts === null
            ? "Tabellen for eksisterende innlegg mangler – kjør migrasjon 4 i Supabase."
            : pagePosts.count
              ? `${pagePosts.count} innlegg fra siden er hentet${pagePosts.lastImported ? ` (sist ${new Date(pagePosts.lastImported).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })})` : ""}. Claude bruker dem for å unngå gjentakelser. Oppdateres automatisk hver natt.`
              : "Ingen innlegg fra siden er hentet ennå. Trykk «Hent eksisterende innlegg» så Claude kjenner historikken."}
        </p>
      )}
      <details className="mt-4 text-sm text-ink-soft">
        <summary className="cursor-pointer text-ink">Hvilke tillatelser brukes?</summary>
        <ul className="ml-4 mt-2 list-disc">
          <li>pages_show_list – vise sidene du administrerer, slik at du kan velge riktig side</li>
          <li>pages_manage_posts – publisere innlegg du har godkjent</li>
          <li>pages_read_engagement – lese reaksjoner, kommentarer og delinger til analysen</li>
        </ul>
        <p className="mt-2">Systemet ber ikke om tilgang til meldinger, Messenger, personlig profil, annonsekontoer eller betalingsinformasjon. Tokenet lagres kryptert på serveren og vises aldri i nettleseren eller for AI-en.{graphVersion ? ` Graph API-versjon: ${graphVersion}.` : ""}</p>
      </details>
    </Card>
  );
}
