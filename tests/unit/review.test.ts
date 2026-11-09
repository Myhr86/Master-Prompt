import { describe, expect, it } from "vitest";
import { analyzePage, PAGE_REVIEW_SYSTEM } from "@/lib/review/analyze";
import { GraphClient } from "@/lib/facebook/graph";
import type { StructuredCaller } from "@/lib/ai/claude";

describe("Sidegjennomgang", () => {
  it("sorterer etter alvor og prioritet, begrenser intro til 101 tegn, og sender bilder", async () => {
    let seen: Parameters<StructuredCaller>[0] | null = null;
    const call = (async (input: Parameters<StructuredCaller>[0]) => {
      seen = input;
      return {
        data: {
          summary: "Siden er ryddig.",
          strengths: ["Fine produktbilder"],
          items: [
            { area: "kategori", status: "bra", priority: "lav", finding: "OK", action: "-", where: "-", suggested_text: null },
            { area: "handlingsknapp", status: "mangler", priority: "hoy", finding: "Ingen knapp", action: "Legg til «Handle nå»", where: "Siden → Legg til knapp", suggested_text: null },
            { area: "beskrivelse", status: "kan_forbedres", priority: "middels", finding: "Kort intro", action: "Skriv ny intro", where: "Siden → Rediger intro", suggested_text: "Personlige gaver" },
            { area: "anmeldelser", status: "kunne_ikke_sjekkes", priority: "lav", finding: "Ikke tilgjengelig", action: "-", where: "-", suggested_text: null },
          ],
          suggested_bio: "x".repeat(140),
          suggested_description: null,
          cover_idea: null,
        },
        model: "claude-opus-5-5",
        usage: {},
      };
    }) as unknown as StructuredCaller;
    const r = await analyzePage({ side: { navn: "Myhr" } }, [{ mediaType: "image/jpeg", base64: "QUJD", label: "coverbilde" }], call);
    expect(r.review.items.map((i) => i.area)).toEqual(["handlingsknapp", "beskrivelse", "anmeldelser", "kategori"]);
    expect(r.review.items.every((i) => i.done === false)).toBe(true);
    expect(r.review.suggested_bio).toHaveLength(101);
    expect(seen!.images).toHaveLength(1);
    expect(seen!.user).toContain("coverbilde");
    expect(seen!.effort).toBe("high");
  });

  it("instruksen forbyr gjetting og krever «kunne ikke sjekkes» for manglende data", () => {
    expect(PAGE_REVIEW_SYSTEM).toContain("kunne_ikke_sjekkes");
    expect(PAGE_REVIEW_SYSTEM).toMatch(/Ikke finn på tall/);
    expect(PAGE_REVIEW_SYSTEM).toContain("101 tegn");
  });

  it("leser sideinformasjon og hopper over felt Facebook avviser", async () => {
    const fetchImpl = (async (u: URL) => {
      const fields = new URL(String(u)).searchParams.get("fields") ?? "";
      if (fields.includes(",")) return new Response(JSON.stringify({ error: { message: "(#100) Tried accessing nonexisting field (about)", code: 100 } }), { status: 400 });
      if (fields === "about" || fields === "rating_count") return new Response(JSON.stringify({ error: { message: "nonexisting field", code: 100 } }), { status: 400 });
      if (fields === "name") return new Response(JSON.stringify({ id: "1", name: "Myhr Tre og Design" }), { status: 200 });
      if (fields === "followers_count") return new Response(JSON.stringify({ id: "1", followers_count: 812 }), { status: 200 });
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as typeof fetch;
    const c = new GraphClient({ appId: "1", appSecret: "s", version: "v1.0", fetchImpl });
    const r = await c.getPageProfile("1", "t");
    expect(r.data).toMatchObject({ name: "Myhr Tre og Design", followers_count: 812 });
    expect(r.unavailable).toEqual(expect.arrayContaining(["about", "rating_count", "website"]));
    expect(r.unavailable).not.toContain("name");
  });
});
