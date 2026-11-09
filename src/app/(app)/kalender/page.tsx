import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, osloParts, osloToUtc, startOfIsoWeek } from "@/lib/dates";
import { upcomingSeasonalEvents } from "@/lib/calendar/seasons";
import { PageHeader } from "@/components/ui";
import { CalendarView, type CalendarPost } from "./calendar-view";

export const metadata: Metadata = { title: "Kalender" };

type View = "maned" | "uke" | "dag";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ visning?: string; dato?: string }> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const view: View = sp.visning === "uke" || sp.visning === "dag" ? sp.visning : "maned";
  const today = osloParts(new Date()).dateKey;
  const anchor = sp.dato && /^\d{4}-\d{2}-\d{2}$/.test(sp.dato) ? sp.dato : today;

  let from: string;
  let to: string;
  if (view === "dag") {
    from = anchor;
    to = addDays(anchor, 1);
  } else if (view === "uke") {
    from = startOfIsoWeek(anchor);
    to = addDays(from, 7);
  } else {
    const first = `${anchor.slice(0, 7)}-01`;
    from = startOfIsoWeek(first);
    const nextMonth = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 1)).toISOString().slice(0, 10);
    to = addDays(startOfIsoWeek(addDays(nextMonth, -1)), 7);
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select("id, title, status, scheduled_at, published_at")
    .or(`and(scheduled_at.gte.${osloToUtc(from, "00:00").toISOString()},scheduled_at.lt.${osloToUtc(to, "00:00").toISOString()}),and(published_at.gte.${osloToUtc(from, "00:00").toISOString()},published_at.lt.${osloToUtc(to, "00:00").toISOString()})`)
    .order("scheduled_at");
  const posts: CalendarPost[] = (data ?? []).map((p) => {
    const when = p.published_at ?? p.scheduled_at;
    const parts = osloParts(new Date(when!));
    return { id: p.id, title: p.title, status: p.status, iso: when!, dateKey: parts.dateKey, time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` };
  });
  const events = upcomingSeasonalEvents(from, to)
    .filter((e) => e.date >= from && e.date < to)
    .map((e) => ({ key: e.key, name: e.name, date: e.date, angle: e.angle }));

  return (
    <div>
      <PageHeader eyebrow="Plan" title="Innholdskalender" subtitle="Dra innlegg til en ny dato (eller bruk «Flytt» på mobil). Klokkeslettet beholdes." />
      <CalendarView view={view} anchor={anchor} today={today} from={from} to={to} posts={posts} events={events} />
    </div>
  );
}
