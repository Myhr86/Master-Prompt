export interface MetricRow {
  post_id: string;
  metric_name: string;
  metric_value: number | string;
  recorded_at: string;
}

/** Siste registrerte verdi per innlegg og metrikk. Rader forventes sortert nyest først. */
export function latestMetricsByPost(rows: MetricRow[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = out.get(r.post_id) ?? {};
    if (!(r.metric_name in m)) m[r.metric_name] = Number(r.metric_value);
    out.set(r.post_id, m);
  }
  return out;
}

export const METRIC_LABEL: Record<string, string> = {
  reactions: "Reaksjoner",
  comments: "Kommentarer",
  shares: "Delinger",
  post_impressions_unique: "Rekkevidde",
  post_impressions: "Visninger",
  post_clicks: "Klikk",
  post_engaged_users: "Engasjerte brukere",
};

export function engagement(m: Record<string, number>): number {
  return (m.reactions ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
}
