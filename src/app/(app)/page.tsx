import Link from "next/link";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacebookStatus, getSettings } from "@/lib/data";
import { integrations } from "@/lib/env";
import { formatLongDate, formatShortDateTime, osloParts, startOfIsoWeek, addDays, WEEKDAYS_NB, osloToUtc } from "@/lib/dates";
import { upcomingSeasonalEvents } from "@/lib/calendar/seasons";
import { ButtonLink, Card, Notice } from "@/components/ui";
import { FacebookStatusPill } from "@/components/facebook-status";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/icons";
import type { Post } from "@/lib/types";
import { effectivePublishMode } from "@/lib/posts/mode";
import { QuickSuggest } from "./generer/quick-suggest";

export const metadata: Metadata = { title: "Oversikt" };

function greeting(hour: number) {
  if (hour < 10) return "God morgen";
  if (hour < 17) return "God dag";
  return "God kveld";
}

export default async function DashboardPage() {
  await requireOwnerPage();
  const supabase = await createClient();
  const now = new Date();
  const today = osloParts(now);
  const weekStart = startOfIsoWeek(today.dateKey);
  const weekEnd = addDays(weekStart, 7);

  const [settings, fb, counts, nextPost, weekPosts, recentlyPublished] = await Promise.all([
    getSettings(),
    getFacebookStatus(),
    Promise.all(
      (["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHED"] as const).map(async (s) => {
        const { count } = await supabase.from("posts").select("id", { count: "exact", head: true }).eq("status", s);
        return [s, count ?? 0] as const;
      }),
    ).then((e) => Object.fromEntries(e) as Record<string, number>),
    supabase.from("posts").select("id, title, scheduled_at, status").eq("status", "SCHEDULED").gte("scheduled_at", now.toISOString()).order("scheduled_at").limit(1).maybeSingle(),
    supabase
      .from("posts")
      .select("id, title, status, scheduled_at, published_at")
      .gte("scheduled_at", osloToUtc(weekStart, "00:00").toISOString())
      .lt("scheduled_at", osloToUtc(weekEnd, "00:00").toISOString())
      .order("scheduled_at"),
    supabase.from("posts").select("id, title, published_at, facebook_post_url").eq("status", "PUBLISHED").order("published_at", { ascending: false }).limit(3),
  ]);

  const integ = integrations();
  const mode = effectivePublishMode(settings.test_mode);
  const seasonal = upcomingSeasonalEvents(today.dateKey, addDays(today.dateKey, 45)).slice(0, 3);
  const plan = [...settings.weekly_plan].sort((a, b) => a.day - b.day);
  const weekItems = (weekPosts.data ?? []) as Pick<Post, "id" | "title" | "status" | "scheduled_at" | "published_at">[];

  const stats = [
    { label: "Utkast", value: counts.DRAFT ?? 0, href: "/innlegg?status=DRAFT" },
    { label: "Venter på godkjenning", value: counts.PENDING_APPROVAL ?? 0, href: "/innlegg?status=PENDING_APPROVAL", highlight: (counts.PENDING_APPROVAL ?? 0) > 0 },
    { label: "Godkjent / planlagt", value: (counts.APPROVED ?? 0) + (counts.SCHEDULED ?? 0), href: "/innlegg?status=APPROVED" },
    { label: "Publisert", value: counts.PUBLISHED ?? 0, href: "/innlegg?status=PUBLISHED" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="grain relative overflow-hidden rounded-card bg-wood-100 px-5 py-7 sm:px-8 sm:py-9">
        <p className="text-sm capitalize text-wood-800/80">{formatLongDate(now)}</p>
        <h1 className="mt-1 text-3xl text-wood-900 sm:text-4xl">{greeting(today.hour)}!</h1>
        <p className="mt-2 max-w-xl text-wood-900/75">
          {counts.PENDING_APPROVAL ? `Du har ${counts.PENDING_APPROVAL} innlegg som venter på din godkjenning.` : "Alt er gjennomgått. Klar for nye ideer?"}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ButtonLink href="/generer">
            <Icon.sparkles /> Generer nye innlegg
          </ButtonLink>
          <QuickSuggest disabled={!integrations().anthropic} variant="inline" />
          <FacebookStatusPill status={fb} metaConfigured={integ.meta} />
          {mode === "simulated" && (
            <Link href="/innstillinger#publisering" className="rounded-full bg-paper/70 px-3 py-1.5 text-sm text-wood-900 ring-1 ring-wood-200">
              Testmodus: publisering simuleres
            </Link>
          )}
        </div>
      </section>

      {!integ.anthropic && (
        <Notice tone="warn" title="Claude er ikke konfigurert">
          Legg inn <code>ANTHROPIC_API_KEY</code> i miljøvariablene på serveren for å kunne generere innlegg. Se README.
        </Notice>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Nøkkeltall">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className={`h-full p-4 transition-shadow hover:shadow-lift sm:p-5 ${s.highlight ? "ring-amber-200" : ""}`}>
              <p className="font-display text-3xl text-ink sm:text-4xl">{s.value}</p>
              <p className="mt-1 text-sm text-ink-soft">{s.label}</p>
            </Card>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl">Ukens innholdsplan</h2>
            <Link href="/kalender" className="text-sm text-wood-700 hover:underline">
              Kalender
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-line">
            {plan.map((p) => {
              const dayKey = addDays(weekStart, p.day - 1);
              const items = weekItems.filter((w) => w.scheduled_at && osloParts(new Date(w.scheduled_at)).dateKey === dayKey);
              return (
                <li key={p.day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="w-28 shrink-0">
                    <p className="text-sm font-medium capitalize text-ink">{WEEKDAYS_NB[p.day - 1]}</p>
                    <p className="text-xs text-ink-mute">{p.theme}</p>
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    {items.length ? (
                      items.map((i) => (
                        <Link key={i.id} href={`/innlegg/${i.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-wood-50 px-3 py-2 text-sm hover:bg-wood-100">
                          <span className="truncate">{i.title || "Uten tittel"}</span>
                          <StatusBadge status={i.status} />
                        </Link>
                      ))
                    ) : (
                      <p className="text-sm text-ink-mute">Ingen innlegg planlagt ennå.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-mute">Temaene er forslag og kan endres under Innstillinger.</p>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="p-5 sm:p-6">
            <h2 className="text-xl">Neste publisering</h2>
            {nextPost.data ? (
              <Link href={`/innlegg/${nextPost.data.id}`} className="mt-3 block rounded-2xl bg-wood-50 p-4 hover:bg-wood-100">
                <p className="text-sm font-medium capitalize text-wood-800">{formatShortDateTime(nextPost.data.scheduled_at!)}</p>
                <p className="mt-1 line-clamp-2 text-ink">{nextPost.data.title || "Uten tittel"}</p>
              </Link>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">Ingen planlagte publiseringer. Godkjenn et innlegg og velg tidspunkt.</p>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="text-xl">Kommende anledninger</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {seasonal.length ? (
                seasonal.map((s) => (
                  <li key={s.key + s.date} className="flex items-center justify-between gap-3 text-sm">
                    <span>{s.name}</span>
                    <span className="text-ink-mute">{formatLongDate(osloToUtc(s.date)).replace(/^\w+ /, "")}</span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-ink-soft">Ingen merkedager de neste ukene.</li>
              )}
            </ul>
          </Card>

          {recentlyPublished.data && recentlyPublished.data.length > 0 && (
            <Card className="p-5 sm:p-6">
              <h2 className="text-xl">Sist publisert</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {recentlyPublished.data.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/innlegg/${p.id}`} className="truncate hover:underline">
                      {p.title || "Uten tittel"}
                    </Link>
                    {p.facebook_post_url && (
                      <a href={p.facebook_post_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-wood-700 hover:underline">
                        Se på Facebook
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
