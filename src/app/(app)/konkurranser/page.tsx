import Link from "next/link";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProducts, getSettings } from "@/lib/data";
import { integrations } from "@/lib/env";
import { formatShortDateTime, osloParts, addDays } from "@/lib/dates";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { ContestForm } from "./contest-form";
import { CONTEST_STATUS } from "@/lib/contests/status";

export const metadata: Metadata = { title: "Konkurranser" };
export const maxDuration = 300;


export default async function ContestsPage() {
  await requireOwnerPage();
  const supabase = await createClient();
  const [{ data, error }, products, settings] = await Promise.all([
    supabase.from("contests").select("id, title, prize, starts_at, ends_at, status, winners").order("created_at", { ascending: false }).limit(50),
    getProducts({ activeOnly: true }),
    getSettings(),
  ]);
  const today = osloParts(new Date()).dateKey;
  const time = settings.preferred_times[0] ?? "19:00";
  return (
    <div>
      <PageHeader
        eyebrow="Flere følgere"
        title="Konkurranser"
        subtitle="Lag konkurranser som følger Facebooks regler og norsk markedsføringsrett. Vilkårene skrives automatisk, Claude skriver resten, og du godkjenner alt."
      />
      {error && (
        <div className="mb-5">
          <Notice tone="warn" title="Databasen mangler en oppdatering">
            Kjør <code>supabase/migrations/20261109000008_contests.sql</code> i Supabase → SQL Editor.
          </Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section aria-label="Konkurranser">
          {(data ?? []).length === 0 ? (
            <EmptyState title="Ingen konkurranser ennå">En godt gjennomført konkurranse er en av de raskeste måtene å få nye følgere på.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {(data ?? []).map((c) => (
                <li key={c.id}>
                  <Link href={`/konkurranser/${c.id}`}>
                    <Card className="p-4 transition-shadow hover:shadow-lift">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{c.title}</p>
                        <Badge className={CONTEST_STATUS[c.status]?.tone ?? ""}>{CONTEST_STATUS[c.status]?.label ?? c.status}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">{c.prize}</p>
                      <p className="mt-1 text-xs capitalize text-ink-mute">
                        {formatShortDateTime(c.starts_at)} – {formatShortDateTime(c.ends_at)}
                      </p>
                      {c.winners?.length > 0 && <p className="mt-1 text-sm">Vinner: {c.winners.join(", ")}</p>}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Card className="p-5">
          <h2 className="text-lg">Ny konkurranse</h2>
          <ContestForm
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            businessName={settings.business_name}
            aiReady={integrations().anthropic}
            defaults={{ start: `${addDays(today, 1)}T${time}`, end: `${addDays(today, 8)}T21:00`, announce: `${addDays(today, 9)}T12:00` }}
          />
        </Card>
      </div>
    </div>
  );
}
