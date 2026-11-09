import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertPublicHttpsUrl, fetchImage, isPrivateAddress, type Lookup } from "@/lib/products/image-fetch";
import { normalizeImageUrls, parseShopify } from "@/lib/products/importer";
import { sanitizeUpload } from "@/lib/images/compose";

const publicDns: Lookup = async () => [{ address: "23.227.38.65", family: 4 }];
const internalDns: Lookup = async () => [{ address: "10.0.0.5", family: 4 }];

describe("Henting av produktbilder fra nettbutikken", () => {
  it("gjenkjenner interne og private adresser", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["23.227.38.65", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("blokkerer http, interne IP-er og vertsnavn som peker internt", async () => {
    await expect(assertPublicHttpsUrl("http://cdn.shopify.com/a.jpg", publicDns)).rejects.toThrow(/https/);
    await expect(assertPublicHttpsUrl("https://169.254.169.254/latest", publicDns)).rejects.toThrow(/intern/);
    await expect(assertPublicHttpsUrl("https://bilder.example/a.jpg", internalDns)).rejects.toThrow(/intern/);
    await expect(assertPublicHttpsUrl("https://cdn.shopify.com/a.jpg", publicDns)).resolves.toBeInstanceOf(URL);
  });

  it("laster ned et ekte bilde fra en offentlig CDN, også via omdirigering", async () => {
    const jpg = await sharp({ create: { width: 50, height: 40, channels: 3, background: "#a0703f" } }).jpeg().toBuffer();
    const fetchImpl = (async (u: string) =>
      u.endsWith("/gammel.jpg")
        ? new Response(null, { status: 301, headers: { location: "https://cdn.shopify.com/ny.jpg" } })
        : new Response(new Uint8Array(jpg), { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    const buf = await fetchImage("https://myhrtreogdesign.com/gammel.jpg", { fetchImpl, lookup: publicDns });
    const clean = await sanitizeUpload(buf);
    expect(clean.width).toBe(50);
  });

  it("følger ikke omdirigering til intern adresse", async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/hemmelig" } })) as unknown as typeof fetch;
    await expect(fetchImage("https://cdn.shopify.com/a.jpg", { fetchImpl, lookup: publicDns })).rejects.toThrow(/intern/);
  });

  it("stopper for store filer", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array(16 * 1024 * 1024), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchImage("https://cdn.shopify.com/a.jpg", { fetchImpl, lookup: publicDns })).rejects.toThrow(/15 MB/);
  });

  it("normaliserer bilde-URL-er fra nettbutikken", () => {
    expect(normalizeImageUrls(["//cdn.shopify.com/a.jpg", "/files/b.png", "http://x.no/c.jpg", "javascript:alert(1)", "//cdn.shopify.com/a.jpg"], "https://myhrtreogdesign.com/p/1")).toEqual([
      "https://cdn.shopify.com/a.jpg",
      "https://myhrtreogdesign.com/files/b.png",
      "https://x.no/c.jpg",
    ]);
    const [p] = parseShopify({ products: [{ id: 1, title: "Flis", handle: "flis", images: [{ src: "//cdn.shopify.com/s/files/flis.jpg" }] }] }, "https://myhrtreogdesign.com/");
    expect(p!.imageUrls).toEqual(["https://cdn.shopify.com/s/files/flis.jpg"]);
  });
});
