import { describe, expect, it, vi } from "vitest";
import { generatePosts } from "@/lib/ai/generator";
import { postcheck, extractPrices, similarity } from "@/lib/ai/postcheck";
import { buildGenerationPrompt, MARKETING_SYSTEM_PROMPT, type GenerationContext } from "@/lib/ai/prompts";
import type { GeneratedPost } from "@/lib/ai/schemas";
import type { StructuredCaller } from "@/lib/ai/claude";
import type { BusinessSettings, Product } from "@/lib/types";

const settings: BusinessSettings = {
  id: 1,
  business_name: "Myhr Tre og Design",
  website: "https://myhrtreogdesign.com/",
  language: "nb-NO",
  brand_voice: "Varm og personlig",
  posting_frequency: 3,
  preferred_days: [1, 3, 5],
  preferred_times: ["19:00"],
  timezone: "Europe/Oslo",
  default_hashtags: ["#myhrtreogdesign"],
  prioritized_product_ids: [],
  weekly_plan: [],
  seasonal_campaigns: [],
  ai_model: "claude-opus-5-5",
  image_provider: "none",
  test_mode: true,
  updated_at: "",
};

const flis: Product = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Testprodukt flis",
  description: "Beskrivelse fra biblioteket",
  price: 499,
  currency: "NOK",
  product_url: "https://myhrtreogdesign.com/products/testflis",
  source: "manual",
  external_id: null,
  active: true,
  needs_verification: false,
  verification_note: null,
  last_synced_at: null,
  source_image_urls: [],
  created_at: "",
  updated_at: "",
};

const now = new Date("2026-11-09T10:00:00Z");
const ctx = (over: Partial<GenerationContext> = {}): GenerationContext => ({
  settings,
  products: [flis],
  productImages: [{ id: "22222222-2222-4222-8222-222222222222", product_id: flis.id, image_type: "product_photo", alt_text: null }],
  recentPosts: [],
  slots: [
    { iso: "2026-11-11T18:00:00.000Z", weekday: "onsdag", theme: "Bak kulissene" },
    { iso: "2026-11-13T18:00:00.000Z", weekday: "fredag", theme: "Gaveinspirasjon" },
  ],
  seasonalEvents: [{ name: "Farsdag", date: "2026-11-08", angle: "Gaver til pappa" }],
  now,
  ...over,
});

const gen = (over: Partial<GeneratedPost> = {}): GeneratedPost => ({
  post_type: "produktpresentasjon",
  title: "En flis full av minner",
  body: "Familiens favorittbilde på en flis.",
  call_to_action: "Se flisen i nettbutikken",
  link_url: flis.product_url,
  product_id: flis.id,
  hashtags: ["#personligegaver", "myhrtreogdesign"],
  image_suggestion: "Ekte produktbilde",
  suggested_image_id: "22222222-2222-4222-8222-222222222222",
  suggested_media_id: null,
  recommended_publish_at: "2026-11-11T18:00:00.000Z",
  rationale: "Fordi …",
  variants: [],
  needs_verification: [],
  quality: { relevance: 4, language: 4, originality: 4, product_accuracy: 5, marketing_value: 4, visual_quality: 4, notes: "" },
  ...over,
});

const pc = (post: GeneratedPost, extra: Partial<Parameters<typeof postcheck>[2]> = {}) =>
  postcheck(post, 0, { products: [flis], productImageIds: new Set(["22222222-2222-4222-8222-222222222222"]), website: settings.website, recentTexts: [], fallbackTimes: ["2026-11-11T18:00:00.000Z"], now, defaultHashtags: [], ...extra });

describe("AI-innholdsprodusent (test 3–4)", () => {
  it("genererer innlegg via Claude med produktbiblioteket som sannhetskilde", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const call = vi.fn(async (_input: Parameters<StructuredCaller>[0]) => ({ data: { posts: [gen(), gen({ post_type: "handverk", product_id: null, link_url: null, suggested_image_id: null })], planning_notes: "Variert uke" }, model: "claude-opus-5-5", usage: {} }));
    const out = await generatePosts(ctx(), call as unknown as StructuredCaller);
    expect(call).toHaveBeenCalledOnce();
    const arg = call.mock.calls[0]![0];
    expect(arg.system).toBe(MARKETING_SYSTEM_PROMPT);
    expect(arg.model).toBe("claude-opus-5-5");
    expect(arg.user).toContain("Testprodukt flis");
    expect(arg.user).toContain("499 NOK");
    expect(arg.user).toContain("Farsdag");
    expect(out.posts).toHaveLength(2);
    expect(out.posts[0]).toMatchObject({ product_id: flis.id, link_url: flis.product_url, hashtags: ["#personligegaver", "#myhrtreogdesign"] });
    expect(out.posts[0]!.content).toContain("Se flisen i nettbutikken");
    expect(out.posts[1]!.link_url).toBe(settings.website); // faller tilbake til nettbutikken
  });

  it("systeminstruksen er stabil (ingen dato) slik at caching fungerer, og inneholder sannhetsreglene", () => {
    expect(MARKETING_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    for (const rule of ["Finn aldri på priser", "kundeuttalelser", "falsk knapphet", "kan aldri godkjenne eller publisere"]) expect(MARKETING_SYSTEM_PROMPT).toContain(rule);
  });

  it("uten pris i biblioteket instrueres Claude til ikke å nevne pris", () => {
    const prompt = buildGenerationPrompt(ctx({ products: [{ ...flis, price: null }] }));
    expect(prompt).toContain("IKKE OPPGITT – ikke nevn pris");
  });

  it("tomt bibliotek: Claude får beskjed om ikke å nevne konkrete produkter", () => {
    expect(buildGenerationPrompt(ctx({ products: [] }))).toContain("Biblioteket er tomt");
  });

  it("innlegg fra Facebook-siden tas med, og Claude bes vurdere hva som passer nå", () => {
    const p = buildGenerationPrompt(
      ctx({
        recentPosts: [
          { title: "", content: "Nye skjærefjøler i heltre er på plass!", post_type: null, status: "PUBLISHED", published_at: "2026-11-02T10:00:00Z", created_at: "2026-11-02T10:00:00Z", source: "facebook", has_image: true },
        ],
      }),
    );
    expect(p).toContain("facebook-siden");
    expect(p).toContain("Nye skjærefjøler i heltre");
    expect(p).toContain("VURDER FØR DU SKRIVER");
    expect(p).toContain("1 publisert");
  });

  it("etterkontrollen sammenligner også med innlegg fra Facebook-siden", async () => {
    const text = "Nye skjærefjøler i heltre er på plass i nettbutikken nå, perfekt som gave";
    const call = vi.fn(async (_input: Parameters<StructuredCaller>[0]) => ({ data: { posts: [gen({ body: text })], planning_notes: "" }, model: "claude-opus-5-5", usage: {} })); // eslint-disable-line @typescript-eslint/no-unused-vars
    const out = await generatePosts(ctx({ slots: [ctx().slots[0]!], recentPosts: [{ title: "", content: text, post_type: null, status: "PUBLISHED", published_at: "2026-11-02", created_at: "2026-11-02", source: "facebook" }] }), call as unknown as StructuredCaller);
    expect(out.posts[0]!.warnings.join(" ")).toMatch(/ligner/);
  });

  it("mediebanken sendes som tekst, og bare gyldige bilde-ID-er beholdes", () => {
    const media = [{ id: "44444444-4444-4444-8444-444444444444", category: "gravering", description: "Laser graverer eikefjøl", tags: ["laser"], product_id: null, people_visible: false, last_used_at: null, use_count: 0 }];
    const p = buildGenerationPrompt(ctx({ mediaLibrary: media }));
    expect(p).toContain("MEDIEBANK");
    expect(p).toContain("Laser graverer eikefjøl");
    expect(p).toContain('"sist_brukt": "aldri"');
    const ok = pc(gen({ suggested_media_id: "44444444-4444-4444-8444-444444444444" }), { mediaIds: new Set(["44444444-4444-4444-8444-444444444444"]) });
    expect(ok.suggested_media_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(pc(gen({ suggested_media_id: "55555555-5555-4555-8555-555555555555" }), { mediaIds: new Set() }).suggested_media_id).toBeNull();
  });

  it("tidligere innlegg sendes med for å unngå gjentakelser", () => {
    const p = buildGenerationPrompt(ctx({ recentPosts: [{ title: "Gammel tittel", content: "Gammel tekst", post_type: "gaveide", status: "PUBLISHED", published_at: "2026-11-01", created_at: "2026-11-01" }] }));
    expect(p).toContain("Gammel tittel");
  });
});

describe("Etterkontroll av AI-forslag (produktkorrekthet)", () => {
  it("fanger opp feil pris", () => {
    const r = pc(gen({ body: "Nå kun 399 kr!" }));
    expect(r.warnings.join(" ")).toMatch(/pris \(399/);
  });
  it("godtar korrekt pris i ulike formater", () => {
    expect(pc(gen({ body: "Koster 499 kr." })).warnings).toHaveLength(0);
    expect(pc(gen({ body: "Pris: kr 499,-" })).warnings).toHaveLength(0);
  });
  it("fanger opp rabatter, falsk knapphet og kundeuttalelser", () => {
    expect(pc(gen({ body: "20 % rabatt denne uken" })).warnings.join(" ")).toMatch(/rabatt/);
    expect(pc(gen({ body: "Nesten utsolgt!" })).warnings.join(" ")).toMatch(/knapphet/);
    expect(pc(gen({ body: "«Helt fantastisk gave» – Kari" })).warnings.join(" ")).toMatch(/kundeuttalelse/);
  });
  it("fjerner oppdiktede produkter, lenker og bilde-ID-er", () => {
    const r = pc(gen({ product_id: "99999999-9999-4999-8999-999999999999", link_url: "https://falsk-butikk.no/x", suggested_image_id: "33333333-3333-4333-8333-333333333333" }));
    expect(r.product_id).toBeNull();
    expect(r.link_url).toBe(settings.website);
    expect(r.suggested_image_id).toBeNull();
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });
  it("erstatter tidspunkt i fortiden med planlagt tidspunkt", () => {
    expect(pc(gen({ recommended_publish_at: "2020-01-01T10:00:00Z" })).scheduled_at).toBe("2026-11-11T18:00:00.000Z");
  });
  it("varsler om tekst som ligner tidligere innlegg", () => {
    const text = "Familiens favorittbilde på en flis som varer i mange år framover";
    expect(pc(gen({ body: text }), { recentTexts: [text] }).warnings.join(" ")).toMatch(/ligner/);
    expect(similarity("helt ulik tekst om noe annet her", text)).toBeLessThan(0.2);
  });
  it("leser ut priser", () => {
    expect(extractPrices("Fra 1 299 kr og kr 499,- samt 89,50 kroner")).toEqual(expect.arrayContaining([1299, 499, 89.5]));
  });
});
