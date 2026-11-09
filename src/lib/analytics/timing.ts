import { osloParts, WEEKDAYS_NB } from "../dates";

/**
 * «Beste tidspunkt å poste» ut fra sidens egne innlegg.
 *
 * Hvert innlegg får en rangering (0–1) blant alle innlegg etter engasjement,
 * og gjennomsnittet per ukedag/tidsrom sammenlignes. Rangering i stedet for
 * råtall gjør at ett viralt innlegg ikke dominerer, og at vekst over tid ikke
 * forskyver resultatet. Små utvalg markeres tydelig – dette er indikasjoner,
 * ikke fasit.
 */
export interface TimedPost {
  created_time: string;
  engagement: number;
}

export const TIME_BUCKETS = [
  { key: "morgen", label: "Morgen (06–10)", from: 6, to: 10 },
  { key: "formiddag", label: "Formiddag (10–13)", from: 10, to: 13 },
  { key: "ettermiddag", label: "Ettermiddag (13–17)", from: 13, to: 17 },
  { key: "kveld", label: "Kveld (17–21)", from: 17, to: 21 },
  { key: "senkveld", label: "Sen kveld (21–24)", from: 21, to: 24 },
  { key: "natt", label: "Natt (00–06)", from: 0, to: 6 },
] as const;

export type BucketKey = (typeof TIME_BUCKETS)[number]["key"];

export const MIN_POSTS_FOR_ADVICE = 8;
export const MIN_POSTS_PER_SLOT = 2;

function bucketOf(hour: number): BucketKey {
  return TIME_BUCKETS.find((b) => hour >= b.from && hour < b.to)!.key;
}

interface Stat {
  n: number;
  score: number; // gjennomsnittlig rangering 0–1 (0,5 = som vanlig)
}

export interface BestTimes {
  sampleSize: number;
  enoughData: boolean;
  byWeekday: ({ day: number; label: string } & Stat)[];
  byBucket: ({ key: BucketKey; label: string } & Stat)[];
  grid: Record<string, Stat>; // `${day}-${bucket}`
  recommendation: { days: number[]; time: string; bucket: BucketKey } | null;
}

/** Rangering 0–1 med delte plasser ved like verdier. */
export function percentileRanks(values: number[]): number[] {
  if (values.length < 2) return values.map(() => 0.5);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const below = sorted.filter((x) => x < v).length;
    const equal = sorted.filter((x) => x === v).length;
    return (below + (equal - 1) / 2) / (values.length - 1);
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function computeBestTimes(posts: TimedPost[]): BestTimes {
  const valid = posts.filter((p) => Number.isFinite(p.engagement) && !Number.isNaN(new Date(p.created_time).getTime()));
  const ranks = percentileRanks(valid.map((p) => p.engagement));
  const rows = valid.map((p, i) => {
    const o = osloParts(new Date(p.created_time));
    return { day: o.isoWeekday, hour: o.hour, minute: o.minute, bucket: bucketOf(o.hour), rank: ranks[i]! };
  });

  const agg = (filter: (r: (typeof rows)[number]) => boolean): Stat => {
    const sel = rows.filter(filter);
    return { n: sel.length, score: sel.length ? sel.reduce((a, r) => a + r.rank, 0) / sel.length : 0 };
  };

  const byWeekday = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, label: WEEKDAYS_NB[day - 1]!, ...agg((r) => r.day === day) }));
  const byBucket = TIME_BUCKETS.map((b) => ({ key: b.key, label: b.label, ...agg((r) => r.bucket === b.key) }));
  const grid: Record<string, Stat> = {};
  for (const d of [1, 2, 3, 4, 5, 6, 7]) for (const b of TIME_BUCKETS) grid[`${d}-${b.key}`] = agg((r) => r.day === d && r.bucket === b.key);

  const enoughData = rows.length >= MIN_POSTS_FOR_ADVICE;
  let recommendation: BestTimes["recommendation"] = null;
  if (enoughData) {
    const days = byWeekday
      .filter((d) => d.n >= MIN_POSTS_PER_SLOT && d.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((d) => d.day)
      .sort((a, b) => a - b);
    const bestBucket = byBucket.filter((b) => b.n >= MIN_POSTS_PER_SLOT).sort((a, b) => b.score - a.score)[0];
    if (days.length && bestBucket) {
      // Typisk klokkeslett i det beste tidsrommet, rundet til nærmeste halvtime.
      const mins = rows.filter((r) => r.bucket === bestBucket.key).map((r) => r.hour * 60 + r.minute);
      const m = Math.round(median(mins) / 30) * 30;
      const time = `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      recommendation = { days, time, bucket: bestBucket.key };
    }
  }
  return { sampleSize: rows.length, enoughData, byWeekday, byBucket, grid, recommendation };
}
