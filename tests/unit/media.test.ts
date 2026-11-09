import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { analyzeImage, prepareForVision } from "@/lib/media/analyze";
import type { StructuredCaller } from "@/lib/ai/claude";

describe("Mediebank: bildebeskrivelse", () => {
  it("skalerer ned før analyse for å spare tokens", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#a0703f" } }).jpeg().toBuffer();
    const meta = await sharp(Buffer.from(await prepareForVision(big), "base64")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
  });

  it("sender bildet til Claude og renser svaret (ukjent produkt fjernes, stikkord normaliseres)", async () => {
    const img = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    const call = vi.fn(async (input: Parameters<StructuredCaller>[0]) => {
      expect(input.images).toHaveLength(1);
      expect(input.images![0]!.mediaType).toBe("image/jpeg");
      expect(input.effort).toBe("low");
      expect(input.user).toContain("11111111-1111-4111-8111-111111111111: Familieflis");
      return {
        data: {
          description: "Lasergravering av en eikefjøl i verkstedet.",
          category: "gravering" as const,
          tags: ["Laser", "eik", "laser", " verksted "],
          product_id: "99999999-9999-4999-8999-999999999999",
          people_visible: false,
          suitable_for: ["bak_kulissene"],
          quality_note: "",
        },
        model: "claude-opus-5-5",
        usage: {},
      };
    });
    const r = await analyzeImage(img, [{ id: "11111111-1111-4111-8111-111111111111", name: "Familieflis" }], call as unknown as StructuredCaller);
    expect(r.category).toBe("gravering");
    expect(r.tags).toEqual(["laser", "eik", "verksted"]);
    expect(r.product_id).toBeNull();
  });
});
