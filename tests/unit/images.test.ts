import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compositeProduct, sanitizeUpload, textGraphic, toFormat, wrapText, escapeXml, backgroundPrompt } from "@/lib/images/compose";

async function jpegWithExif() {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: "#a0703f" } })
    .withMetadata({ exif: { IFD0: { Copyright: "Hemmelig", Artist: "Kunde" } } })
    .jpeg()
    .toBuffer();
}

describe("Bildeopplasting (test 5)", () => {
  it("godtar ekte bilder og fjerner metadata (EXIF/GPS)", async () => {
    const input = await jpegWithExif();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await sanitizeUpload(input);
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.width).toBe(400);
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
  });
  it("avviser filer som ikke er bilder, uansett filnavn/MIME", async () => {
    await expect(sanitizeUpload(Buffer.from("<html><script>alert(1)</script></html>"))).rejects.toThrow(/gyldig bilde/);
    await expect(sanitizeUpload(Buffer.alloc(0))).rejects.toThrow(/tom/);
  });
  it("avviser for store filer", async () => {
    await expect(sanitizeUpload(Buffer.alloc(16 * 1024 * 1024))).rejects.toThrow(/15 MB/);
  });
});

describe("Bildeverksted", () => {
  it("lager Facebook-formater", async () => {
    const src = await jpegWithExif();
    for (const [f, w, h] of [["square", 1080, 1080], ["portrait", 1080, 1350], ["landscape", 1200, 630], ["cover", 1640, 624]] as const) {
      const m = await sharp(await toFormat(src, f)).metadata();
      expect([m.width, m.height]).toEqual([w, h]);
    }
  });

  it("miljøbilde bevarer det ekte produktet nøyaktig (ingen endring av form/farge)", async () => {
    // Produkt: rød ramme rundt blått felt – lett å verifisere piksel for piksel.
    const product = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#cc0000" } })
      .composite([{ input: await sharp({ create: { width: 160, height: 160, channels: 3, background: "#0033cc" } }).png().toBuffer(), left: 20, top: 20 }])
      .png()
      .toBuffer();
    const bg = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#efe4d4" } }).png().toBuffer();
    const out = await compositeProduct(bg, product, { format: "square", scale: 0.5, position: "center", shadow: false });
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    // Produktet skaleres til 540×540 og sentreres (270..810). Midten skal være blå, kanten rød, utenfor bakgrunn.
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 24);
    expect(near(px(540, 540), [0, 0x33, 0xcc])).toBe(true);
    expect(near(px(280, 540), [0xcc, 0, 0])).toBe(true);
    expect(near(px(100, 100), [0xef, 0xe4, 0xd4])).toBe(true);
    // Proporsjoner bevares: et ikke-kvadratisk produkt forvrenges ikke.
    const wide = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#00aa00" } }).png().toBuffer();
    const out2 = await compositeProduct(bg, wide, { format: "square", scale: 0.5, position: "center", shadow: false });
    const r2 = await sharp(out2).raw().toBuffer({ resolveWithObject: true });
    const px2 = (x: number, y: number) => Array.from(r2.data.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3));
    expect(near(px2(540, 540), [0, 0xaa, 0])).toBe(true); // innenfor 540×270
    expect(near(px2(540, 400), [0xef, 0xe4, 0xd4])).toBe(true); // over produktet: bakgrunn (ikke strukket)
  });

  it("lager tekstgrafikk med korrekt escaping", async () => {
    const out = await textGraphic({ format: "portrait", headline: "Minner som varer <&>", subline: "Personlige fliser", theme: "wood" });
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([1080, 1350]);
    expect(escapeXml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
    expect(wrapText("en to tre fire fem seks sju åtte", 9, 2)).toEqual(["en to tre", "fire fem…"]);
  });

  it("bakgrunnsprompt ber eksplisitt om at produktet IKKE skal genereres", () => {
    expect(backgroundPrompt("stue", "square")).toMatch(/IKKE inneholde noe produkt/);
  });
});
