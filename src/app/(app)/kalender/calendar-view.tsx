"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addDays, MONTHS_NB, WEEKDAYS_NB, WEEKDAYS_SHORT_NB } from "@/lib/dates";
import { STATUS_LABEL, type PostStatus } from "@/lib/posts/status";
import { Button, Card, Input, Notice, cx } from "@/components/ui";
import { movePost } from "../innlegg/actions";

export interface CalendarPost {
  id: string;
  title: string;
  status: PostStatus;
  iso: string;
  dateKey: string;
  time: string;
}

const DOT: Record<PostStatus, string> = {
  DRAFT: "bg-stone-400",
  PENDING_APPROVAL: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  SCHEDULED: "bg-sky-500",
  PUBLISHING: "bg-violet-500",
  PUBLISHED: "bg-wood-600",
  REJECTED: "bg-rose-400",
  FAILED: "bg-red-600",
};

const LOCKED: PostStatus[] = ["PUBLISHED", "PUBLISHING"];

function monthName(key: string) {
  return `${MONTHS_NB[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

export function CalendarView({ view, anchor, today, from, to, posts, events }: { view: "maned" | "uke" | "dag"; anchor: string; today: string; from: string; to: string; posts: CalendarPost[]; events: { key: string; name: string; date: string; angle: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [moving, setMoving] = useState<CalendarPost | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);

  const days: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);

  const move = (id: string, date: string) =>
    start(async () => {
      const r = await movePost(id, date);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "Flyttet." : r.error });
      setMoving(null);
      if (r.ok) router.refresh();
    });

  const step = (dir: 1 | -1) => {
    if (view === "dag") return addDays(anchor, dir);
    if (view === "uke") return addDays(anchor, 7 * dir);
    const y = Number(anchor.slice(0, 4));
    const m = Number(anchor.slice(5, 7)) - 1 + dir;
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  };
  const title = view === "maned" ? monthName(anchor) : view === "uke" ? `Uke fra ${Number(from.slice(8))}. ${MONTHS_NB[Number(from.slice(5, 7)) - 1]}` : `${WEEKDAYS_NB[(new Date(anchor).getUTCDay() + 6) % 7]} ${Number(anchor.slice(8))}. ${MONTHS_NB[Number(anchor.slice(5, 7)) - 1]}`;

  const PostChip = ({ p, compact }: { p: CalendarPost; compact?: boolean }) => (
    <div
      draggable={!LOCKED.includes(p.status)}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
      className={cx("group flex items-center gap-1.5 rounded-lg bg-paper px-2 py-1 text-xs ring-1 ring-line", !LOCKED.includes(p.status) && "cursor-grab active:cursor-grabbing")}
    >
      <span className={cx("size-2 shrink-0 rounded-full", DOT[p.status])} aria-hidden />
      <Link href={`/innlegg/${p.id}`} className="min-w-0 flex-1 truncate hover:underline" title={`${STATUS_LABEL[p.status]} – ${p.title}`}>
        <span className="tabular-nums text-ink-mute">{p.time}</span> {compact ? "" : p.title || "Uten tittel"}
      </Link>
      {!LOCKED.includes(p.status) && (
        <button
          onClick={() => {
            setMoving(p);
            setMoveDate(p.dateKey);
          }}
          className="shrink-0 text-wood-700 underline lg:hidden"
        >
          Flytt
        </button>
      )}
    </div>
  );

  const DayCell = ({ day, tall }: { day: string; tall?: boolean }) => {
    const items = posts.filter((p) => p.dateKey === day);
    const ev = events.filter((e) => e.date === day);
    const outside = view === "maned" && day.slice(0, 7) !== anchor.slice(0, 7);
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(day);
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(null);
          const id = e.dataTransfer.getData("text/plain");
          if (id) move(id, day);
        }}
        className={cx("flex flex-col gap-1 border-line p-1.5", tall ? "min-h-48" : "min-h-24", outside && "bg-linen/60 text-ink-mute", dragOver === day && "bg-wood-100")}
      >
        <div className="flex items-center justify-between">
          <span className={cx("flex size-6 items-center justify-center rounded-full text-xs", day === today && "bg-wood-700 font-semibold text-white")}>{Number(day.slice(8))}</span>
        </div>
        {ev.map((e) => (
          <Link key={e.key} href={`/generer?anledning=${e.key}`} className="truncate rounded-md bg-moss-50 px-1.5 py-0.5 text-[11px] text-moss-700 hover:underline" title={`${e.angle} – trykk for å lage forslag`}>
            ✦ {e.name}
          </Link>
        ))}
        {items.map((p) => (
          <PostChip key={p.id} p={p} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/kalender?visning=${view}&dato=${step(-1)}`} className="flex size-10 items-center justify-center rounded-full ring-1 ring-line hover:bg-wood-50" aria-label="Forrige">
            ‹
          </Link>
          <Link href={`/kalender?visning=${view}&dato=${step(1)}`} className="flex size-10 items-center justify-center rounded-full ring-1 ring-line hover:bg-wood-50" aria-label="Neste">
            ›
          </Link>
          <h2 className="ml-1 text-xl capitalize">{title}</h2>
          <Link href={`/kalender?visning=${view}`} className="ml-2 text-sm text-wood-700 underline">
            I dag
          </Link>
        </div>
        <div className="flex rounded-full bg-wood-50 p-1 ring-1 ring-line">
          {(
            [
              ["maned", "Måned"],
              ["uke", "Uke"],
              ["dag", "Dag"],
            ] as const
          ).map(([k, l]) => (
            <Link key={k} href={`/kalender?visning=${k}&dato=${anchor}`} className={cx("rounded-full px-3.5 py-1.5 text-sm", view === k ? "bg-paper font-medium shadow-soft" : "text-ink-soft")}>
              {l}
            </Link>
          ))}
        </div>
      </div>

      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}
      {pending && <p className="text-sm text-ink-mute">Flytter …</p>}

      {moving && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <p className="text-sm font-medium">Flytt «{moving.title || "Uten tittel"}»</p>
            <Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} className="mt-2" />
          </div>
          <div className="flex gap-2">
            <Button disabled={!moveDate || pending} onClick={() => move(moving.id, moveDate)}>
              Flytt
            </Button>
            <Button variant="ghost" onClick={() => setMoving(null)}>
              Avbryt
            </Button>
          </div>
        </Card>
      )}

      {view === "maned" && (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-7 border-b border-line bg-wood-50 text-center text-xs font-medium uppercase tracking-wider text-ink-mute sm:grid">
            {WEEKDAYS_SHORT_NB.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="hidden grid-cols-7 divide-x divide-y divide-line sm:grid">
            {days.map((d) => (
              <DayCell key={d} day={d} />
            ))}
          </div>
          {/* Mobil: kompakt liste over dager med innhold */}
          <ul className="divide-y divide-line sm:hidden">
            {days
              .filter((d) => d.slice(0, 7) === anchor.slice(0, 7))
              .filter((d) => posts.some((p) => p.dateKey === d) || events.some((e) => e.date === d) || d === today)
              .map((d) => (
                <li key={d} className="flex gap-3 p-3">
                  <div className="w-12 shrink-0 text-center">
                    <p className="text-[11px] uppercase text-ink-mute">{WEEKDAYS_SHORT_NB[(new Date(d).getUTCDay() + 6) % 7]}</p>
                    <p className={cx("font-display text-xl", d === today && "text-wood-700")}>{Number(d.slice(8))}</p>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {events.filter((e) => e.date === d).map((e) => (
                      <Link key={e.key} href={`/generer?anledning=${e.key}`} className="rounded-md bg-moss-50 px-2 py-1 text-xs text-moss-700">
                        ✦ {e.name} – lag forslag
                      </Link>
                    ))}
                    {posts.filter((p) => p.dateKey === d).map((p) => (
                      <PostChip key={p.id} p={p} />
                    ))}
                    {!posts.some((p) => p.dateKey === d) && !events.some((e) => e.date === d) && <p className="text-sm text-ink-mute">I dag – ingenting planlagt</p>}
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {view === "uke" && (
        <Card className="overflow-hidden">
          <div className="grid divide-y divide-line sm:grid-cols-7 sm:divide-x sm:divide-y-0">
            {days.map((d, i) => (
              <div key={d}>
                <p className="border-b border-line bg-wood-50 px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-ink-mute">{WEEKDAYS_SHORT_NB[i]}</p>
                <DayCell day={d} tall />
              </div>
            ))}
          </div>
        </Card>
      )}

      {view === "dag" && (
        <Card className="p-4">
          {events.map((e) => (
            <Link key={e.key} href={`/generer?anledning=${e.key}`} className="mb-3 block rounded-xl bg-moss-50 px-3 py-2 text-sm text-moss-700">
              ✦ {e.name}: {e.angle} – lag forslag
            </Link>
          ))}
          {posts.length ? (
            <ul className="flex flex-col gap-2">
              {posts.map((p) => (
                <li key={p.id}>
                  <PostChip p={p} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Ingen innlegg denne dagen.</p>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Forklaring">
        {(Object.keys(STATUS_LABEL) as PostStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cx("size-2 rounded-full", DOT[s])} /> {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
