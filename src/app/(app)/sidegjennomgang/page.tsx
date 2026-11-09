import Link from "next/link";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacebookStatus } from "@/lib/data";
import { integrations } from "@/lib/env";
import { formatShortDateTime } from "@/lib/dates";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { ReviewView, RunReviewButton } from "./review-view";
import type { ReviewDoc, ReviewItem } from "@/lib/review/analyze";

export const metadata: Metadata = { title: "Sidegjennomgang" };
export const maxDuration = 300;

export default async function PageReviewPage() {
  await requireOwnerPage();
  const supabase = await createClient();
  const [fb, { data, error }] = await Promise.all([getFacebookStatus(), supabase.from("page_reviews").select("id, created_at, result, snapshot").order("created_at", { ascending: false }).limit(10)]);
  const latest = data?.[0];
  const integ = integrations();
  const canRun = integ.anthropic && integ.meta && fb?.connection_status === "connected";
  return (
    <div>
      <PageHeader
        eyebrow="Facebook-siden"
        title="Sidegjennomgang"
        subtitle="Claude går gjennom siden din – intro, lenker, handlingsknapp, bilder, hvor ofte du poster og hva som engasjerer – og gir en prioritert liste med konkrete forbedringer du kan gjøre selv."
        actions={<RunReviewButton disabled={!canRun} hasPrevious={Boolean(latest)} />}
      />
      {error && (
        <div className="mb-5">
          <Notice tone="warn" title="Databasen mangler en oppdatering">
            Kjør <code>supabase/migrations/20261109000010_page_reviews.sql</code> i Supabase → SQL Editor.
          </Notice>
        </div>
      )}
      {!canRun && (
        <div className="mb-5">
          <Notice tone="info">
            Gjennomgangen krever at Claude er konfigurert og at Facebook-siden er tilkoblet. <Link href="/innstillinger#facebook" className="underline">Gå til innstillinger</Link>
          </Notice>
        </div>
      )}
      {latest ? (
        <>
          <ReviewView id={latest.id} createdAt={latest.created_at} review={latest.result as ReviewDoc} snapshot={latest.snapshot as { side?: { folgere?: number | null; lenke?: string | null } }} />
          {(data ?? []).length > 1 && (
            <Card className="mt-6 p-5">
              <h2 className="text-lg">Tidligere gjennomganger</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-soft">
                {(data ?? []).slice(1).map((r) => {
                  const items = ((r.result as ReviewDoc).items ?? []) as ReviewItem[];
                  const open = items.filter((i) => i.status !== "bra" && i.status !== "kunne_ikke_sjekkes" && !i.done).length;
                  const followers = (r.snapshot as { side?: { folgere?: number | null } }).side?.folgere;
                  return (
                    <li key={r.id} className="capitalize">
                      {formatShortDateTime(r.created_at)} – {open} åpne punkter{followers != null ? ` · ${followers} følgere` : ""}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <EmptyState title="Ingen gjennomgang ennå">Trykk «Kjør gjennomgang». Det tar omtrent et minutt og koster noen få kroner i bruk av Claude (ca. 50–70 øre).</EmptyState>
      )}
    </div>
  );
}
