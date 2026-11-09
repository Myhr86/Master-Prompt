import { addDays } from "../dates";

/**
 * Norske høytider og merkedager som er relevante for gaver og personlige
 * produkter. Datoene beregnes – ingen kampanjer antas aktive uten at eieren
 * godkjenner innlegg om dem.
 */
export interface SeasonalEvent {
  key: string;
  name: string;
  date: string; // YYYY-MM-DD (hoveddato / start av sesong)
  endDate?: string; // for sesonger
  leadDays: number; // hvor mange dager i forveien innlegg bør publiseres
  angle: string; // innholdsvinkel for AI-en
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Første påskedag (gregoriansk, anonym algoritme). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** N-te søndag i en måned (1-basert måned). */
export function nthSunday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = søndag
  const day = 1 + ((7 - first) % 7) + (n - 1) * 7;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function seasonalEventsForYear(year: number): SeasonalEvent[] {
  const christmasEve = `${year}-12-24`;
  const firstAdvent = addDays(christmasEve, -(new Date(Date.UTC(year, 11, 24)).getUTCDay() + 21));
  return [
    { key: "valentin", name: "Valentinsdagen", date: `${year}-02-14`, leadDays: 14, angle: "Personlige gaver til kjæresten, minner fra forholdet" },
    { key: "morsdag", name: "Morsdag", date: nthSunday(year, 2, 2), leadDays: 18, angle: "Gaver til mamma med familiebilder og minner" },
    { key: "paske", name: "Påske", date: easterSunday(year), leadDays: 14, angle: "Påskestemning, hytte og familietid" },
    { key: "konfirmasjon", name: "Konfirmasjonssesong", date: `${year}-04-20`, endDate: `${year}-06-10`, leadDays: 21, angle: "Personlige konfirmasjonsgaver med varig verdi" },
    { key: "17mai", name: "17. mai", date: `${year}-05-17`, leadDays: 7, angle: "Feiring, familie og norsk håndverk" },
    { key: "bryllup", name: "Bryllupssesong", date: `${year}-06-01`, endDate: `${year}-08-31`, leadDays: 14, angle: "Bryllupsgaver og minner fra den store dagen" },
    { key: "sommer", name: "Sommergaver", date: `${year}-06-15`, endDate: `${year}-07-31`, leadDays: 10, angle: "Gaver til vertskap, hytteliv og sommerminner" },
    { key: "farsdag", name: "Farsdag", date: nthSunday(year, 11, 2), leadDays: 18, angle: "Gaver til pappa, bestefar og familiens minner" },
    { key: "julegaver", name: "Julegaver", date: `${year}-11-01`, endDate: christmasEve, leadDays: 0, angle: "Personlige julegaver – husk å bestille i god tid (frister må bekreftes)" },
    { key: "advent", name: "Første søndag i advent", date: firstAdvent, leadDays: 5, angle: "Adventsstemning og juleforberedelser" },
    { key: "jul", name: "Jul", date: christmasEve, leadDays: 10, angle: "Julestemning, familie og takk for året" },
  ];
}

/** Hendelser hvis publiseringsvindu overlapper [fromKey, toKey]. */
export function upcomingSeasonalEvents(fromKey: string, toKey: string): SeasonalEvent[] {
  const y = Number(fromKey.slice(0, 4));
  const all = [...seasonalEventsForYear(y), ...seasonalEventsForYear(y + 1)];
  return all
    .filter((e) => {
      const windowStart = addDays(e.date, -e.leadDays);
      const windowEnd = e.endDate ?? e.date;
      return windowStart <= toKey && windowEnd >= fromKey;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
