export const TIMEZONE = "Europe/Oslo";

const dateFmt = new Intl.DateTimeFormat("nb-NO", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("nb-NO", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("nb-NO", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });

export const formatLongDate = (d: Date | string) => dateFmt.format(new Date(d));
export const formatShortDateTime = (d: Date | string) => shortFmt.format(new Date(d));
export const formatTime = (d: Date | string) => timeFmt.format(new Date(d));

/** Deler av en dato i Oslo-tid. */
export function osloParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    isoWeekday: wd,
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Konverterer lokal Oslo-tid (YYYY-MM-DD + HH:MM) til et UTC-tidspunkt. */
export function osloToUtc(dateKey: string, time = "12:00"): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  // Gjett UTC og korriger for Oslo-forskyvningen (håndterer sommertid).
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = osloParts(new Date(guess));
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc;
  }
  return new Date(guess);
}

/** Legger til dager på en datonøkkel (YYYY-MM-DD). */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isoWeekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Mandag i uken for en gitt dato. */
export function startOfIsoWeek(dateKey: string): string {
  return addDays(dateKey, 1 - isoWeekdayOf(dateKey));
}

export const WEEKDAYS_NB = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];
export const WEEKDAYS_SHORT_NB = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
export const MONTHS_NB = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

/** Neste gang (fra og med i morgen) en gitt ukedag + klokkeslett inntreffer, i Oslo-tid. */
export function nextSlots(from: Date, days: number[], times: string[], count: number): Date[] {
  const out: Date[] = [];
  const startKey = osloParts(from).dateKey;
  const sortedTimes = [...times].sort();
  for (let i = 1; i <= 60 && out.length < count; i++) {
    const key = addDays(startKey, i);
    if (!days.includes(isoWeekdayOf(key))) continue;
    for (const t of sortedTimes) {
      if (out.length >= count) break;
      out.push(osloToUtc(key, t));
    }
  }
  return out;
}

/**
 * Som nextSlots, men hopper over dager som allerede har et innlegg
 * (busyDayKeys = YYYY-MM-DD i Oslo-tid). Faller tilbake til vanlige
 * tidspunkter hvis det ikke finnes ledige dager innen 60 dager.
 */
export function nextFreeSlots(from: Date, days: number[], time: string, count: number, busyDayKeys: Set<string>): Date[] {
  const candidates = nextSlots(from, days, [time], count + busyDayKeys.size + 30);
  const free = candidates.filter((d) => !busyDayKeys.has(osloParts(d).dateKey)).slice(0, count);
  return free.length === count ? free : nextSlots(from, days, [time], count);
}
