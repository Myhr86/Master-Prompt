import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacebookStatus } from "@/lib/data";
import { integrations } from "@/lib/env";
import { latestMetricsByPost, METRIC_LABEL, engagement } from "@/lib/analytics/summary";
import { formatShortDateTime } from "@/lib/dates";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { POST_TYPE_LABEL } from "@/lib/ai/schemas";
import { AnalyticsActions } from "./analytics-actions";

export const metadata: Metadata = { title: "Analyse" };
export const maxDuration = 300;

export default async function AnalyticsPage() {
  await requireOwnerPage();
  const supabase = await createClient();
  const [fb, { data: posts }, { data: metrics }] = await Promise.all([
    getFacebookStatus(),
    supabase.from("posts").select("id, title, post_type, published_at, facebook_post_url").eq("status", "PUBLISHED").order("published_at", { ascending: false }).limit(100),
    supabase.from("analytics").select("post_id, metric_name, metric_value, recorded_at").order("recorded_at", { ascending: false }).limit(10000),
  ]);
  const latest = latestMetricsByPost(metrics ?? []);
  const withData = (posts ?? []).filter((p) => latest.has(p.id));
  const metricNames = [...new Set((metrics ?? []).map((m) => m.metric_name))];
  const totals: Record<string, number> = {};
  for (const p of withData) for (const [k, v] of Object.entries(latest.get(p.id)!)) totals[k] = (totals[k] ?? 0) + v;

  // Utvikling over tid: engasjement per publisert innlegg (kronologisk)
  const series = [...withData].reverse().map((p) => ({ id: p.id, label: p.published_at!.slice(5, 10), value: engagement(latest.get(p.id)!) }));
  const maxV = Math.max(1, ...series.map((s) => s.value));

  // Per innleggstype
  const byType = new Map<string, { n: number; sum: number }>();
  for (const p of withData) {
    const t = p.post_type ?? "ukjent";
    const cur = byType.get(t) ?? { n: 0, sum: 0 };
    cur.n++;
    cur.sum += engagement(latest.get(p.id)!);
    byType.set(t, cur);
  }

  const integ = integrations();
  return (
    <div>
      <PageHeader eyebrow="Resultater" title="Analyse" subtitle="Tall hentes direkte fra Facebook. Metrikker Facebook ikke gir tilgang til, vises ikke – ingenting anslås." />
      {(!integ.meta || fb?.connection_status !== "connected") && (
        <div className="mb-5">
          <Notice tone="info" title="Ingen aktiv Facebook-tilkobling">
            Statistikk krever tilkoblet side og tillatelsen pages_read_engagement (Advanced Access via Meta App Review for produksjon). <Link href="/innstillinger#facebook" className="underline">Gå til innstillinger</Link>
          </Notice>
        </div>
      )}
      <AnalyticsActions canRefresh={integ.meta && fb?.connection_status === "connected"} canAnalyze={integ.anthropic && withData.length >= 3} />

      {withData.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Ingen statistikk ennå">Når innlegg er publisert og statistikk er hentet, vises rekkevidde, reaksjoner, kommentarer og delinger her.</EmptyState>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Totalt">
            {metricNames.map((m) => (
              <Card key={m} className="p-4">
                <p className="font-display text-3xl tabular-nums">{(totals[m] ?? 0).toLocaleString("nb-NO")}</p>
                <p className="text-sm text-ink-soft">{METRIC_LABEL[m] ?? m}</p>
              </Card>
            ))}
          </section>
          <p className="-mt-3 text-xs text-ink-mute">Summert over {withData.length} innlegg med statistikk. Klikk og rekkevidde vises bare hvis Facebook gir tilgang til dem.</p>

          <Card className="p-5">
            <h2 className="text-lg">Engasjement per innlegg over tid</h2>
            <p className="text-xs text-ink-mute">Reaksjoner + kommentarer + delinger</p>
            <div className="mt-4 flex h-40 items-end gap-1.5 overflow-x-auto" role="img" aria-label="Søylediagram over engasjement">
              {series.map((s) => (
                <div key={s.id} className="flex min-w-6 flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] tabular-nums text-ink-soft">{s.value}</span>
                  <div className="w-full max-w-10 rounded-t-md bg-wood-400" style={{ height: `${Math.max(4, (s.value / maxV) * 120)}px` }} />
                  <span className="text-[10px] text-ink-mute">{s.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg">Per innleggstype</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {[...byType.entries()].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).map(([t, v]) => (
                <li key={t} className="flex items-center justify-between">
                  <span>{POST_TYPE_LABEL[t as keyof typeof POST_TYPE_LABEL] ?? t}</span>
                  <span className="tabular-nums text-ink-soft">
                    {(v.sum / v.n).toFixed(1)} i snitt · {v.n} innlegg
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="overflow-x-auto p-5">
            <h2 className="text-lg">Innlegg</h2>
            <table className="mt-3 w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink-mute">
                  <th className="py-2 pr-3 font-medium">Innlegg</th>
                  {metricNames.map((m) => (
                    <th key={m} className="py-2 pr-3 text-right font-medium">
                      {METRIC_LABEL[m] ?? m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {withData.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/innlegg/${p.id}`} className="line-clamp-1 hover:underline">
                        {p.title || "Uten tittel"}
                      </Link>
                      <span className="text-xs capitalize text-ink-mute">{formatShortDateTime(p.published_at!)}</span>
                    </td>
                    {metricNames.map((m) => (
                      <td key={m} className="py-2 pr-3 text-right tabular-nums">
                        {latest.get(p.id)![m] ?? <span className="text-ink-mute">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
