/**
 * Regler for video på Facebook.
 * Reels: stående (ca. 9:16), 3–90 sekunder, minst 540×960. Andre videoer
 * publiseres som vanlige videoinnlegg.
 */
export interface VideoMeta {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export const REEL_MIN_SECONDS = 3;
export const REEL_MAX_SECONDS = 90;

export function reelEligibility(v: VideoMeta): { ok: true } | { ok: false; reason: string } {
  if (v.durationSeconds === null || v.width === null || v.height === null) return { ok: false, reason: "Ukjent lengde eller format." };
  if (v.durationSeconds < REEL_MIN_SECONDS) return { ok: false, reason: `Kortere enn ${REEL_MIN_SECONDS} sekunder.` };
  if (v.durationSeconds > REEL_MAX_SECONDS) return { ok: false, reason: `Lengre enn ${REEL_MAX_SECONDS} sekunder.` };
  if (v.height / v.width < 1.6) return { ok: false, reason: "Ikke stående format (9:16)." };
  if (v.width < 540 || v.height < 960) return { ok: false, reason: "Lavere oppløsning enn 540×960." };
  return { ok: true };
}

/** Tidspunkter (sekunder) for stillbilder som sendes til Claude. */
export function frameTimes(duration: number, count = 5): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const n = Math.max(1, Math.min(count, Math.floor(duration) + 1));
  return Array.from({ length: n }, (_, i) => Math.round(((duration * (i + 0.5)) / n) * 100) / 100);
}

export function isVideoPath(path: string | null | undefined): boolean {
  return /\.(mp4|mov)$/i.test(path ?? "");
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
