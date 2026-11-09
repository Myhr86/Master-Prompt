/**
 * «Balanse i innholdet»: fordeling av innleggstyper i en periode, sammenlignet
 * med en sunn miks for en småbedrift (ikke for mye direkte salg).
 */
export const PILLARS = [
  { key: "salg", label: "Produkt og salg", types: ["produktpresentasjon", "trafikk_nettbutikk", "personlig_produkt"], min: 0.2, max: 0.4 },
  { key: "inspirasjon", label: "Gaveideer og anledninger", types: ["gaveide", "sesongkampanje", "hoytid_merkedag"], min: 0.15, max: 0.35 },
  { key: "handverk", label: "Håndverk og bak kulissene", types: ["handverk", "bak_kulissene"], min: 0.15, max: 0.35 },
  { key: "engasjement", label: "Engasjement og spørsmål", types: ["engasjement", "konkurranse"], min: 0.1, max: 0.25 },
] as const;

export type PillarKey = (typeof PILLARS)[number]["key"];

export function pillarOf(postType: string | null | undefined): PillarKey | null {
  return PILLARS.find((p) => (p.types as readonly string[]).includes(postType ?? ""))?.key ?? null;
}

export interface MixItem {
  post_type: string | null;
  engagement?: number | null;
}

export interface ContentMix {
  total: number;
  unknown: number;
  pillars: { key: PillarKey; label: string; count: number; share: number; min: number; max: number; status: "for_lite" | "ok" | "for_mye"; avgEngagement: number | null }[];
  warnings: string[];
  next: { key: PillarKey; label: string } | null;
}

export function computeMix(items: MixItem[]): ContentMix {
  const known = items.filter((i) => pillarOf(i.post_type));
  const total = known.length;
  const pillars = PILLARS.map((p) => {
    const sel = known.filter((i) => pillarOf(i.post_type) === p.key);
    const share = total ? sel.length / total : 0;
    const eng = sel.map((i) => i.engagement).filter((e): e is number => typeof e === "number");
    return {
      key: p.key,
      label: p.label,
      count: sel.length,
      share,
      min: p.min,
      max: p.max,
      status: (share < p.min ? "for_lite" : share > p.max ? "for_mye" : "ok") as "for_lite" | "ok" | "for_mye",
      avgEngagement: eng.length ? eng.reduce((a, b) => a + b, 0) / eng.length : null,
    };
  });
  const warnings: string[] = [];
  if (total >= 4) {
    for (const p of pillars) {
      if (p.status === "for_mye") warnings.push(`Mye «${p.label.toLowerCase()}» (${Math.round(p.share * 100)} %). Anbefalt er maks ${Math.round(p.max * 100)} %.`);
      if (p.status === "for_lite") warnings.push(`Lite «${p.label.toLowerCase()}» (${Math.round(p.share * 100)} %). Anbefalt er minst ${Math.round(p.min * 100)} %.`);
    }
  }
  // Neste innlegg: søylen lengst under sitt minimum (eller under midtpunktet).
  const next = total
    ? [...pillars].sort((a, b) => a.share - (a.min + a.max) / 2 - (b.share - (b.min + b.max) / 2))[0]!
    : null;
  return { total, unknown: items.length - total, pillars, warnings, next: next ? { key: next.key, label: next.label } : null };
}

/** Kort tekst til Claude om miksen siste periode. */
export function mixSummaryForPrompt(mix: ContentMix, days: number): string {
  if (mix.total < 3) return "";
  const parts = mix.pillars.map((p) => `${p.label}: ${p.count} (${Math.round(p.share * 100)} %, anbefalt ${Math.round(p.min * 100)}–${Math.round(p.max * 100)} %)`);
  return [
    `BALANSE I INNHOLDET siste ${days} dager (publisert + planlagt): ${parts.join("; ")}.`,
    mix.warnings.length ? `Merk: ${mix.warnings.join(" ")}` : "",
    mix.next ? `Det som mangler mest nå er «${mix.next.label}» – prioriter dette med mindre eieren ber om noe annet.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
