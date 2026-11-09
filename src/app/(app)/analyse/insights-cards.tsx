import Link from "next/link";
import { Card, cx } from "@/components/ui";
import { TIME_BUCKETS, MIN_POSTS_FOR_ADVICE, type BestTimes } from "@/lib/analytics/timing";
import type { ContentMix } from "@/lib/analytics/mix";
import { WEEKDAYS_NB, WEEKDAYS_SHORT_NB } from "@/lib/dates";
import { ApplyTimesButton, ClassifyButton } from "./insights-buttons";

function cellTone(score: number, n: number) {
  if (!n) return "bg-transparent text-ink-mute";
  if (score >= 0.65) return "bg-moss-500 text-white";
  if (score >= 0.5) return "bg-moss-100 text-moss-700";
  if (score >= 0.35) return "bg-wood-100 text-wood-800";
  return "bg-stone-100 text-stone-600";
}

export function BestTimesCard({ bt, current, hasTable }: { bt: BestTimes; current: { days: number[]; times: string[] }; hasTable: boolean }) {
  const usedBuckets = TIME_BUCKETS.filter((b) => bt.byBucket.find((x) => x.key === b.key)!.n > 0);
  return (
    <Card className="p-5">
      <h2 className="text-lg">Beste tidspunkt å poste</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Basert på {bt.sampleSize} innlegg på siden med reaksjoner, kommentarer og delinger (siste 6 måneder). Grønt = bedre respons enn vanlig for siden. Dette er indikasjoner – ikke fasit.
      </p>
      {!hasTable ? (
        <p className="mt-3 text-sm text-amber-800">Kjør migrasjon 7 (supabase/migrations/20261109000007_page_post_metrics.sql) og trykk «Hent eksisterende innlegg» under Innstillinger.</p>
      ) : !bt.enoughData ? (
        <p className="mt-3 text-sm text-ink-mute">
          Trenger minst {MIN_POSTS_FOR_ADVICE} innlegg med statistikk (har {bt.sampleSize}). Trykk «Hent eksisterende innlegg» under Innstillinger → Facebook for å hente tall for sidens innlegg.
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-0.5 text-center text-[11px] sm:border-spacing-1 sm:text-xs">
              <thead>
                <tr>
                  <th className="w-9" />
                  {usedBuckets.map((b) => (
                    <th key={b.key} className="px-0.5 font-medium leading-tight text-ink-mute">
                      <span className="hidden sm:block">{b.label.replace(/ \(.*/, "")}</span>
                      <span className="block font-normal">{b.label.match(/\((.*)\)/)?.[1]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <tr key={d}>
                    <th className="pr-2 text-left font-medium capitalize text-ink-soft">{WEEKDAYS_SHORT_NB[d - 1]}</th>
                    {usedBuckets.map((b) => {
                      const c = bt.grid[`${d}-${b.key}`]!;
                      return (
                        <td key={b.key} className={cx("rounded-lg py-2 tabular-nums", cellTone(c.score, c.n))} title={c.n ? `${c.n} innlegg` : "Ingen innlegg"}>
                          {c.n ? c.n : "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-ink-mute">Tallet i hver rute er antall innlegg. Ruter med bare ett innlegg er usikre.</p>
          </div>
          {bt.recommendation ? (
            <div className="mt-4 rounded-2xl bg-moss-50 p-4 text-sm">
              <p className="font-medium text-moss-700">
                Anbefaling: {bt.recommendation.days.map((d) => WEEKDAYS_NB[d - 1]).join(", ")} rundt kl. {bt.recommendation.time}
              </p>
              <p className="mt-1 text-ink-soft">
                Nå: {current.days.map((d) => WEEKDAYS_NB[d - 1]).join(", ")} kl. {current.times.join(", ")}.
              </p>
              <div className="mt-3">
                <ApplyTimesButton days={bt.recommendation.days} time={bt.recommendation.time} />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-mute">Ingen tydelig forskjell mellom dager og tider ennå. Fortsett å poste på ulike tidspunkter, så blir bildet klarere.</p>
          )}
        </>
      )}
    </Card>
  );
}

export function MixCard({ mix, longTerm, unclassified, aiReady }: { mix: ContentMix; longTerm: ContentMix; unclassified: number; aiReady: boolean }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg">Balanse i innholdet</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Siste 30 dager (publisert på siden + forslag som venter, er godkjent eller planlagt). Sider med for mye direkte reklame mister ofte rekkevidde.
      </p>
      {mix.total < 3 ? (
        <p className="mt-3 text-sm text-ink-mute">For få innlegg med kjent type de siste 30 dagene til å si noe om balansen.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {mix.pillars.map((p) => {
            const lt = longTerm.pillars.find((x) => x.key === p.key);
            return (
              <li key={p.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{p.label}</span>
                  <span className={cx("tabular-nums", p.status === "ok" ? "text-ink-soft" : "text-amber-800")}>
                    {p.count} · {Math.round(p.share * 100)} %{" "}
                    <span className="text-xs text-ink-mute">
                      (anbefalt {Math.round(p.min * 100)}–{Math.round(p.max * 100)} %)
                    </span>
                  </span>
                </div>
                <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-wood-50">
                  <div className="absolute inset-y-0 bg-moss-100" style={{ left: `${p.min * 100}%`, width: `${(p.max - p.min) * 100}%` }} aria-hidden />
                  <div className={cx("absolute inset-y-0 left-0 rounded-full", p.status === "ok" ? "bg-moss-500" : "bg-amber-500")} style={{ width: `${Math.max(2, p.share * 100)}%` }} />
                </div>
                {lt?.avgEngagement != null && <p className="mt-0.5 text-xs text-ink-mute">Snitt engasjement siste 6 mnd: {lt.avgEngagement.toFixed(1)} ({lt.count} innlegg)</p>}
              </li>
            );
          })}
        </ul>
      )}
      {mix.warnings.length > 0 && (
        <ul className="mt-3 ml-4 list-disc text-sm text-amber-800">
          {mix.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {mix.next && mix.total >= 3 && (
        <p className="mt-3 text-sm">
          Neste innlegg bør gjerne være: <span className="font-medium">{mix.next.label.toLowerCase()}</span>. Claude får vite dette automatisk.{" "}
          <Link href="/generer" className="text-wood-700 underline">
            Lag innlegg
          </Link>
        </p>
      )}
      {(mix.unknown > 0 || unclassified > 0) && (
        <div className="mt-4 border-t border-line pt-3 text-sm text-ink-soft">
          <p>{unclassified} innlegg publisert utenom appen mangler type. Claude kan anslå typen ut fra teksten (noen få øre).</p>
          {aiReady && (
            <div className="mt-2">
              <ClassifyButton />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
