import { describe, expect, it } from "vitest";
import { computeBestTimes, percentileRanks } from "@/lib/analytics/timing";
import { computeMix, mixSummaryForPrompt, pillarOf } from "@/lib/analytics/mix";

// Oslo-tid: vintertid UTC+1. 18:00 UTC = 19:00 lokalt.
const at = (date: string, utcHour: number) => `${date}T${String(utcHour).padStart(2, "0")}:00:00Z`;

describe("Beste tidspunkt", () => {
  it("rangerer robust (delte plasser, uteliggere dominerer ikke)", () => {
    expect(percentileRanks([1, 2, 2, 1000])).toEqual([0, 0.5, 0.5, 1]);
  });

  it("gir ingen anbefaling med for lite data", () => {
    const r = computeBestTimes([{ created_time: at("2026-11-02", 18), engagement: 5 }]);
    expect(r.enoughData).toBe(false);
    expect(r.recommendation).toBeNull();
  });

  it("finner dagene og tidsrommet som gir best respons", () => {
    const posts = [
      // Onsdag og fredag kveld: høyt engasjement
      ...["2026-11-04", "2026-11-11", "2026-11-18"].map((d) => ({ created_time: at(d, 18), engagement: 40 })), // ons 19:00
      ...["2026-11-06", "2026-11-13", "2026-11-20"].map((d) => ({ created_time: at(d, 18), engagement: 35 })), // fre 19:00
      // Mandag formiddag: lavt
      ...["2026-11-02", "2026-11-09", "2026-11-16"].map((d) => ({ created_time: at(d, 9), engagement: 3 })), // man 10:00
      { created_time: at("2026-11-03", 9), engagement: 4 }, // tir 10:00
    ];
    const r = computeBestTimes(posts);
    expect(r.enoughData).toBe(true);
    expect(r.recommendation).toEqual({ days: [3, 5], time: "19:00", bucket: "kveld" });
    expect(r.byWeekday.find((d) => d.day === 1)!.score).toBeCloseTo(1 / 9); // tre like laveste verdier av ti
  });
});

describe("Balanse i innholdet", () => {
  it("plasserer innleggstyper i riktig gruppe", () => {
    expect(pillarOf("gaveide")).toBe("inspirasjon");
    expect(pillarOf("bak_kulissene")).toBe("handverk");
    expect(pillarOf(null)).toBeNull();
  });

  it("varsler om for mye salg og foreslår det som mangler", () => {
    const items = [
      ...Array(6).fill({ post_type: "produktpresentasjon", engagement: 5 }),
      { post_type: "gaveide", engagement: 10 },
      { post_type: "gaveide", engagement: 12 },
      { post_type: null },
    ];
    const m = computeMix(items);
    expect(m.total).toBe(8);
    expect(m.unknown).toBe(1);
    expect(m.pillars.find((p) => p.key === "salg")!.status).toBe("for_mye");
    expect(m.warnings.join(" ")).toMatch(/Mye «produkt og salg» \(75 %\)/);
    expect(["handverk", "engasjement"]).toContain(m.next!.key);
    expect(m.pillars.find((p) => p.key === "inspirasjon")!.avgEngagement).toBe(11);
    const text = mixSummaryForPrompt(m, 30);
    expect(text).toContain("BALANSE I INNHOLDET siste 30 dager");
    expect(text).toContain("prioriter");
  });

  it("gir ingen prompttekst med for få innlegg", () => {
    expect(mixSummaryForPrompt(computeMix([{ post_type: "gaveide" }]), 30)).toBe("");
  });
});
