import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, safeEqual } from "@/lib/crypto";
import { redact } from "@/lib/logger";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");

describe("Kryptering av Facebook-token (AES-256-GCM)", () => {
  it("krypterer og dekrypterer", () => {
    const enc = encryptSecret("EAAhemmelig", KEY);
    expect(enc).not.toContain("EAAhemmelig");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc, KEY)).toBe("EAAhemmelig");
  });
  it("gir ulikt chiffer hver gang (tilfeldig IV)", () => {
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY));
  });
  it("avviser feil nøkkel og manipulerte data", () => {
    const enc = encryptSecret("EAAhemmelig", KEY);
    expect(() => decryptSecret(enc, OTHER)).toThrow();
    const parts = enc.split(".");
    parts[3] = Buffer.from("tuklet").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
  });
  it("krever 32 byte nøkkel", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 byte/);
  });
  it("sammenligner i konstant tid", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});

describe("Logging maskerer hemmeligheter", () => {
  it("maskerer nøkler etter navn og kjente tokenformater", () => {
    const out = redact({
      access_token: "EAAxxxxxxxxxxxxxxxxxxxxxxxxxx",
      nested: { apiKey: "sk-ant-abcdefghijklmnop", message: "kall med EAABBBBBBBBBBBBBBBBBBBBBBBBB feilet" },
      url: "https://graph.facebook.com/me?access_token=EAAsecret&fields=id",
      ok: "vanlig tekst",
    }) as Record<string, unknown>;
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/EAAx|EAAB|sk-ant-abc|EAAsecret/);
    expect(s).toContain("vanlig tekst");
  });
});
