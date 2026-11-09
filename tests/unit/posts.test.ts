import { describe, expect, it } from "vitest";
import { composeFacebookMessage, postContentHash } from "@/lib/posts/content-hash";
import { parseHashtags, postEditSchema } from "@/lib/posts/validation";
import { buildMessage, validateForPublishing, type PublishablePost } from "@/lib/posts/publisher";

const base: PublishablePost = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Minner som varer",
  content: "Tekst",
  hashtags: ["#a"],
  link_url: "https://myhrtreogdesign.com/",
  image_path: null,
  status: "APPROVED",
  approved_at: new Date().toISOString(),
  approved_content_hash: null,
  facebook_post_id: null,
};
const approved = (p: Partial<PublishablePost> = {}): PublishablePost => {
  const post = { ...base, ...p };
  return { ...post, approved_content_hash: p.approved_content_hash ?? postContentHash(post) };
};

describe("Innholdshash", () => {
  it("endres når tekst, emneknagger, lenke eller bilde endres", () => {
    const h = postContentHash(base);
    expect(postContentHash({ ...base, content: "Annen" })).not.toBe(h);
    expect(postContentHash({ ...base, hashtags: ["#b"] })).not.toBe(h);
    expect(postContentHash({ ...base, link_url: "https://myhrtreogdesign.com/x" })).not.toBe(h);
    expect(postContentHash({ ...base, image_path: "a.jpg" })).not.toBe(h);
    expect(postContentHash({ ...base })).toBe(h);
  });
});

describe("validateForPublishing (test 7, 9)", () => {
  it("godtar godkjent innlegg med uendret innhold", () => {
    expect(validateForPublishing(approved())).toBeNull();
  });
  it("avviser ikke-godkjente statuser", () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "REJECTED"] as const) {
      expect(validateForPublishing(approved({ status }))).toMatchObject({ ok: false, reason: "not_approved" });
    }
  });
  it("avviser innhold endret etter godkjenning", () => {
    const p = approved();
    expect(validateForPublishing({ ...p, content: "Endret i ettertid" })).toMatchObject({ ok: false, reason: "approval_invalid" });
  });
  it("avviser allerede publiserte innlegg", () => {
    expect(validateForPublishing(approved({ facebook_post_id: "1_2" }))).toMatchObject({ ok: false, reason: "already_published" });
  });
});

describe("Facebook-tekst", () => {
  it("setter sammen overskrift, tekst og emneknagger uten duplikat", () => {
    expect(composeFacebookMessage({ title: "Hei", content: "Hei der", hashtags: ["#a", "#b"] })).toBe("Hei der\n\n#a #b");
    expect(composeFacebookMessage({ title: "Overskrift", content: "Brødtekst", hashtags: [] })).toBe("Overskrift\n\nBrødtekst");
  });
  it("bildeinnlegg får lenken i teksten", () => {
    expect(buildMessage(approved({ image_path: "x.jpg" }), true)).toContain("https://myhrtreogdesign.com/");
    expect(buildMessage(approved(), false)).not.toContain("https://");
  });
});

describe("Validering av redigering (test 6)", () => {
  it("tolker emneknagger", () => {
    expect(parseHashtags("#Gaver, norskhåndverk #gaver ugyldig! #ok_1")).toEqual(["#Gaver", "#norskhåndverk", "#gaver", "#ok_1"]);
  });
  it("krever https-lenker og ikke-tom tekst", () => {
    const ok = postEditSchema.safeParse({ id: base.id, title: "", content: "Tekst", hashtags: [], link_url: "https://myhrtreogdesign.com/", product_id: "" });
    expect(ok.success).toBe(true);
    expect(postEditSchema.safeParse({ id: base.id, title: "", content: "Tekst", hashtags: [], link_url: "http://usikker.no", product_id: "" }).success).toBe(false);
    expect(postEditSchema.safeParse({ id: base.id, title: "", content: "   ", hashtags: [], link_url: "", product_id: "" }).success).toBe(false);
    expect(postEditSchema.safeParse({ id: base.id, title: "", content: "x", hashtags: [], link_url: "javascript:alert(1)", product_id: "" }).success).toBe(false);
  });
});
