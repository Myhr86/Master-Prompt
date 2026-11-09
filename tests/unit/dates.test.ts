import { describe, expect, it } from "vitest";
import { addDays, nextSlots, osloParts, osloToUtc, startOfIsoWeek } from "@/lib/dates";
import { easterSunday, nthSunday, seasonalEventsForYear, upcomingSeasonalEvents } from "@/lib/calendar/seasons";

describe("Datoer i Oslo-tid", () => {
  it("håndterer sommer- og vintertid", () => {
    expect(osloToUtc("2026-07-01", "19:00").toISOString()).toBe("2026-07-01T17:00:00.000Z");
    expect(osloToUtc("2026-12-01", "19:00").toISOString()).toBe("2026-12-01T18:00:00.000Z");
  });
  it("finner neste foretrukne publiseringstidspunkter", () => {
    const slots = nextSlots(new Date("2026-11-09T10:00:00Z"), [1, 3, 5], ["19:00"], 3).map((d) => osloParts(d).dateKey);
    expect(slots).toEqual(["2026-11-11", "2026-11-13", "2026-11-16"]);
  });
  it("uke starter på mandag", () => {
    expect(startOfIsoWeek("2026-11-15")).toBe("2026-11-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("Norske merkedager", () => {
  it("beregner påske, morsdag, farsdag og advent riktig", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(nthSunday(2026, 2, 2)).toBe("2026-02-08"); // morsdag
    expect(nthSunday(2026, 11, 2)).toBe("2026-11-08"); // farsdag
    expect(seasonalEventsForYear(2026).find((e) => e.key === "advent")!.date).toBe("2026-11-29");
    expect(seasonalEventsForYear(2023).find((e) => e.key === "advent")!.date).toBe("2023-12-03");
  });
  it("foreslår relevante anledninger fram i tid", () => {
    const keys = upcomingSeasonalEvents("2026-11-09", "2026-12-20").map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["julegaver", "advent", "jul"]));
    expect(keys).not.toContain("paske");
  });
});
