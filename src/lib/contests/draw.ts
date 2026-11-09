import { createHash, randomInt } from "node:crypto";

/** Rydder en innlimt deltakerliste: én per linje, uten duplikater og tomme linjer. */
export function parseEntries(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Trekker vinnere med kryptografisk tilfeldighet. Returnerer også en hash av
 * deltakerlisten, slik at trekningen kan dokumenteres uten å lagre listen.
 */
export function drawWinners(entries: string[], count: number, rng: (max: number) => number = (max) => randomInt(max)): { winners: string[]; listHash: string } {
  if (entries.length === 0) throw new Error("Deltakerlisten er tom.");
  const pool = [...entries];
  const winners: string[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const idx = rng(pool.length);
    winners.push(pool.splice(idx, 1)[0]!);
  }
  const listHash = createHash("sha256").update(entries.join("\n"), "utf8").digest("hex");
  return { winners, listHash };
}
