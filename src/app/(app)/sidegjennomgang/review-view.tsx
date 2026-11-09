"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Notice, cx } from "@/components/ui";
import { PRIORITY_LABEL, REVIEW_AREA_LABEL, STATUS_LABEL, type ReviewDoc } from "@/lib/review/analyze";
import { runPageReview, toggleReviewItem } from "./actions";

const STATUS_TONE: Record<string, string> = {
  bra: "bg-moss-50 text-moss-700 ring-moss-100",
  kan_forbedres: "bg-amber-50 text-amber-800 ring-amber-200",
  mangler: "bg-rose-50 text-rose-700 ring-rose-200",
  kunne_ikke_sjekkes: "bg-stone-100 text-stone-600 ring-stone-200",
};

export function RunReviewButton({ disabled, hasPrevious }: { disabled: boolean; hasPrevious: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await runPageReview();
            if (!r.ok) setErr(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Claude går gjennom siden … (ca. 1 min)" : hasPrevious ? "Kjør ny gjennomgang" : "Kjør gjennomgang"}
      </Button>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-wood-700 underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* utklippstavle ikke tilgjengelig */
        }
      }}
    >
      {copied ? "Kopiert ✓" : "Kopier"}
    </button>
  );
}

export function ReviewView({ id, createdAt, review, snapshot }: { id: string; createdAt: string; review: ReviewDoc; snapshot: { side?: { folgere?: number | null; lenke?: string | null } } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showDone, setShowDone] = useState(false);
  const open = review.items.filter((i) => i.status !== "bra" && i.status !== "kunne_ikke_sjekkes");
  const visible = review.items.filter((i) => showDone || !i.done);
  const doneCount = open.filter((i) => i.done).length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg">Oppsummering</h2>
          <p className="text-xs text-ink-mute">
            {new Date(createdAt).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })}
            {snapshot.side?.folgere != null ? ` · ${snapshot.side.folgere} følgere` : ""}
          </p>
        </div>
        <p className="mt-2 text-sm">{review.summary}</p>
        {review.strengths.length > 0 && (
          <>
            <p className="mt-4 text-sm font-medium">Dette fungerer bra</p>
            <ul className="ml-4 mt-1 list-disc text-sm text-ink-soft">
              {review.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-ink-mute">
            <span>Fremdrift</span>
            <span>
              {doneCount} av {open.length} forbedringer gjort
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-wood-50">
            <div className="h-full bg-moss-500" style={{ width: `${open.length ? (doneCount / open.length) * 100 : 100}%` }} />
          </div>
        </div>
        {snapshot.side?.lenke && (
          <a href={snapshot.side.lenke} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-wood-700 underline">
            Åpne siden på Facebook
          </a>
        )}
      </Card>

      {(review.suggested_bio || review.suggested_description || review.cover_idea) && (
        <Card className="p-5">
          <h2 className="text-lg">Tekstforslag</h2>
          {review.suggested_bio && (
            <div className="mt-3 rounded-2xl bg-wood-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">Intro ({review.suggested_bio.length}/101 tegn)</p>
                <CopyButton text={review.suggested_bio} />
              </div>
              <p className="mt-1 text-sm">{review.suggested_bio}</p>
            </div>
          )}
          {review.suggested_description && (
            <div className="mt-3 rounded-2xl bg-wood-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">Beskrivelse</p>
                <CopyButton text={review.suggested_description} />
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{review.suggested_description}</p>
            </div>
          )}
          {review.cover_idea && (
            <div className="mt-3 rounded-2xl bg-wood-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">Idé til coverbilde</p>
              <p className="mt-1 text-sm">{review.cover_idea}</p>
              <Link href="/bilder?mal=cover" className="mt-2 inline-block text-sm text-wood-700 underline">
                Lag coverbilde i bildeverkstedet
              </Link>
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Forbedringer</h2>
          {doneCount > 0 && (
            <button className="text-sm text-wood-700 underline" onClick={() => setShowDone(!showDone)}>
              {showDone ? "Skjul gjorte" : `Vis gjorte (${doneCount})`}
            </button>
          )}
        </div>
        <ul className="mt-3 flex flex-col gap-3">
          {visible.map((item) => {
            const index = review.items.indexOf(item);
            const actionable = item.status !== "bra" && item.status !== "kunne_ikke_sjekkes";
            return (
              <li key={index} className={cx("rounded-2xl p-4 ring-1 ring-line", item.done ? "bg-moss-50/50 opacity-70" : "bg-paper")}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{REVIEW_AREA_LABEL[item.area] ?? item.area}</p>
                  <Badge className={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                  {actionable && <span className="text-xs text-ink-mute">Prioritet: {PRIORITY_LABEL[item.priority]}</span>}
                </div>
                <p className="mt-1 text-sm text-ink-soft">{item.finding}</p>
                {actionable && (
                  <>
                    <p className="mt-2 text-sm">
                      <span className="font-medium">Gjør dette:</span> {item.action}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-mute">Hvor: {item.where}</p>
                    {item.suggested_text && (
                      <div className="mt-2 rounded-xl bg-wood-50 p-2.5 text-sm">
                        <div className="flex justify-end">
                          <CopyButton text={item.suggested_text} />
                        </div>
                        <p className="whitespace-pre-line">{item.suggested_text}</p>
                      </div>
                    )}
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-moss-600"
                        checked={Boolean(item.done)}
                        disabled={pending}
                        onChange={(e) => start(async () => { await toggleReviewItem(id, index, e.target.checked); router.refresh(); })}
                      />
                      Gjort
                    </label>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
