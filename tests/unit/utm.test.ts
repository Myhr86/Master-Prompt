import { describe, expect, it } from "vitest";
import { slugCampaign, utmContentFor, utmFromSettings, withUtm, DEFAULT_UTM } from "@/lib/posts/utm";

const W = "https://myhrtreogdesign.com/";
const ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("Sporingskoder (UTM) på lenker", () => {
  it("legger på kode for lenker til nettbutikken", () => {
    const u = new URL(withUtm("https://myhrtreogdesign.com/products/familietre", W, { settings: DEFAULT_UTM, campaign: "gaveide", postId: ID })!);
    expect(Object.fromEntries(u.searchParams)).toEqual({ utm_source: "facebook", utm_medium: "social", utm_campaign: "gaveide", utm_content: "1a2b3c4d" });
    expect(u.pathname).toBe("/products/familietre");
  });

  it("gjelder også www-varianten og beholder andre parametere", () => {
    const u = new URL(withUtm("https://www.myhrtreogdesign.com/products/x?variant=12", W, { settings: DEFAULT_UTM, campaign: null, postId: ID })!);
    expect(u.searchParams.get("variant")).toBe("12");
    expect(u.searchParams.get("utm_campaign")).toBe("innlegg");
  });

  it("er idempotent og oppdaterer gamle koder i stedet for å duplisere", () => {
    const once = withUtm("https://myhrtreogdesign.com/?utm_source=gammel", W, { settings: DEFAULT_UTM, campaign: "jul", postId: ID })!;
    const twice = withUtm(once, W, { settings: DEFAULT_UTM, campaign: "jul", postId: ID });
    expect(twice).toBe(once);
    expect(once.match(/utm_source/g)).toHaveLength(1);
    expect(new URL(once).searchParams.get("utm_source")).toBe("facebook");
  });

  it("rører ikke andre domener, ugyldige lenker eller når sporing er slått av", () => {
    expect(withUtm("https://www.facebook.com/x", W, { settings: DEFAULT_UTM, campaign: "a", postId: ID })).toBe("https://www.facebook.com/x");
    expect(withUtm("ikke en lenke", W, { settings: DEFAULT_UTM, campaign: "a", postId: ID })).toBe("ikke en lenke");
    expect(withUtm(null, W, { settings: DEFAULT_UTM, campaign: "a", postId: ID })).toBeNull();
    expect(withUtm("https://myhrtreogdesign.com/", W, { settings: { ...DEFAULT_UTM, enabled: false }, campaign: "a", postId: ID })).toBe("https://myhrtreogdesign.com/");
  });

  it("lager trygge kampanjenavn og korte koder", () => {
    expect(slugCampaign("Høytid / merkedag – Påske")).toBe("hoytid_merkedag_paske");
    expect(utmContentFor(ID)).toBe("1a2b3c4d");
    expect(utmFromSettings({})).toEqual(DEFAULT_UTM);
    expect(utmFromSettings({ utm_enabled: false, utm_source: "fb", utm_medium: "organisk" })).toEqual({ enabled: false, source: "fb", medium: "organisk" });
  });
});
