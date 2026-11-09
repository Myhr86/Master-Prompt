import { describe, expect, it } from "vitest";
import { buildReminderFooter, buildRulesText, contestCompliance, entryInstruction, META_DISCLAIMER } from "@/lib/contests/rules";
import { drawWinners, parseEntries } from "@/lib/contests/draw";
import { generateContestPosts, templateContestPosts } from "@/lib/contests/generate";
import type { StructuredCaller } from "@/lib/ai/claude";

const base = {
  title: "Vinn familieflis",
  prize: "Familieflis med eget bilde (20 × 20 cm)",
  question: "Hvilket bilde ville du valgt?",
  entry_method: "kommentar" as const,
  min_age: 18,
  region: "Norge",
  starts_at: "2026-11-16T18:00:00Z",
  ends_at: "2026-11-23T20:00:00Z",
  announce_at: "2026-11-24T11:00:00Z",
  winner_count: 1,
  delivery_note: "Sendes gratis.",
  business_name: "Myhr Tre og Design",
};

describe("Konkurranser: vilkår og Facebooks regler", () => {
  it("vilkårene inneholder alt som kreves", () => {
    const r = buildRulesText(base);
    for (const part of ["Slik deltar du", "Frist:", "Premie: Familieflis", "trekker én vinner tilfeldig", "kunngjøres", "Gratis å delta", "over 18 år", "Norge", "Arrangør: Myhr Tre og Design", META_DISCLAIMER]) {
      expect(r).toContain(part);
    }
    expect(r).toMatch(/mandag 23\. november.*21:00/); // norsk tid
  });

  it("beskriver deltakelse riktig", () => {
    expect(entryInstruction(base)).toBe("Svar på spørsmålet («Hvilket bilde ville du valgt?») i kommentarfeltet");
    expect(entryInstruction({ entry_method: "kommentar_like", question: null })).toBe("Lik dette innlegget og legg igjen en kommentar");
  });

  it("fanger opp formuleringer Facebook ikke tillater", () => {
    const ok = `Vi har konkurranse!\n\n${buildRulesText(base)}`;
    expect(contestCompliance(ok)).toEqual([]);
    expect(contestCompliance(`Del innlegget for å være med! ${META_DISCLAIMER}`).join(" ")).toMatch(/deling/);
    expect(contestCompliance(`Tagg en venn som fortjener flisen! ${META_DISCLAIMER}`).join(" ")).toMatch(/tagge/);
    expect(contestCompliance(`Del for ekstra lodd ${META_DISCLAIMER}`).join(" ")).toMatch(/Ekstra lodd/);
    expect(contestCompliance("Vinn en flis!").join(" ")).toMatch(/erklæringen/);
  });

  it("påminnelsen gjentar deltakelse, frist og erklæring", () => {
    const f = buildReminderFooter(base);
    expect(f).toContain("Slik deltar du:");
    expect(f).toContain("Frist:");
    expect(contestCompliance(`Siste sjanse!\n\n${f}`)).toEqual([]);
  });

  it("rydder deltakerlisten", () => {
    expect(parseEntries("Kari Nordmann\n\n  Ola  Hansen \nkari nordmann\nPer")).toEqual(["Kari Nordmann", "Ola Hansen", "Per"]);
  });

  it("trekker unike vinnere og gir sporbar hash", () => {
    const seq = [1, 0];
    const r = drawWinners(["A", "B", "C"], 2, () => seq.shift()!);
    expect(r.winners).toEqual(["B", "A"]);
    expect(r.listHash).toMatch(/^[0-9a-f]{64}$/);
    expect(drawWinners(["A"], 3).winners).toEqual(["A"]);
    expect(() => drawWinners([], 1)).toThrow(/tom/);
  });

  it("trekningen er jevnt fordelt (kryptografisk tilfeldighet)", () => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (let i = 0; i < 4000; i++) counts[drawWinners(["A", "B", "C", "D"], 1).winners[0]!]!++;
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(850);
  });
});

describe("Konkurranser: innlegg", () => {
  it("legger alltid til vilkår og fanger opp forbudte formuleringer fra AI", async () => {
    const call = (async () => ({
      data: {
        announcement: { title: "Vinn en familieflis!", body: "Vi gir bort en flis. Del innlegget for å være med!", hashtags: ["konkurranse", "#gave"] },
        reminder: { title: "Siste sjanse", body: "I morgen trekker vi vinneren.", hashtags: ["#konkurranse"] },
        winner: { title: "Vinneren er klar", body: "Takk til alle som var med!", hashtags: [] },
      },
      model: "claude-opus-5-5",
      usage: {},
    })) as unknown as StructuredCaller;
    const r = await generateContestPosts(base, null, call);
    const [ann, rem, win] = r.posts;
    expect(ann!.content).toContain("Vilkår:");
    expect(ann!.content).toContain(META_DISCLAIMER);
    expect(ann!.hashtags).toEqual(["#konkurranse", "#gave"]);
    expect(ann!.warnings.join(" ")).toMatch(/deling/);
    expect(rem!.content).toContain("Frist:");
    expect(rem!.warnings).toEqual([]);
    expect(win!.content).toContain("[VINNER]");
  });

  it("maler uten AI er i tråd med reglene", () => {
    const [ann, rem] = templateContestPosts(base);
    expect(ann!.warnings).toEqual([]);
    expect(rem!.warnings).toEqual([]);
  });
});
