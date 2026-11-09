import { describe, expect, it } from "vitest";
import { formatDuration, frameTimes, isVideoPath, reelEligibility } from "@/lib/media/video";
import { GraphClient } from "@/lib/facebook/graph";

describe("Video: Reels-regler og stillbilder", () => {
  it("vurderer om en video kan bli Reel", () => {
    expect(reelEligibility({ durationSeconds: 30, width: 1080, height: 1920 })).toEqual({ ok: true });
    expect(reelEligibility({ durationSeconds: 120, width: 1080, height: 1920 })).toMatchObject({ ok: false, reason: expect.stringMatching(/90/) });
    expect(reelEligibility({ durationSeconds: 30, width: 1920, height: 1080 })).toMatchObject({ ok: false, reason: expect.stringMatching(/stående/) });
    expect(reelEligibility({ durationSeconds: 2, width: 1080, height: 1920 }).ok).toBe(false);
    expect(reelEligibility({ durationSeconds: 30, width: 360, height: 640 })).toMatchObject({ ok: false, reason: expect.stringMatching(/oppløsning/) });
    expect(reelEligibility({ durationSeconds: null, width: 1080, height: 1920 }).ok).toBe(false);
  });

  it("fordeler stillbilder jevnt gjennom videoen", () => {
    expect(frameTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
    expect(frameTimes(1.5, 5)).toHaveLength(2);
    expect(frameTimes(NaN)).toEqual([0]);
  });

  it("gjenkjenner video og formaterer lengde", () => {
    expect(isVideoPath("uploads/videos/2026/11/a.mp4")).toBe(true);
    expect(isVideoPath("uploads/2026/11/a.MOV")).toBe(true);
    expect(isVideoPath("uploads/a.jpg")).toBe(false);
    expect(formatDuration(75.4)).toBe("1:15");
  });
});

describe("Video: Facebook Graph API", () => {
  it("publiserer Reel i tre steg og lar Facebook hente filen fra URL", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, string> }[] = [];
    const fetchImpl = (async (u: string | URL, init?: RequestInit) => {
      const url = String(u);
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url, method: init?.method ?? "GET", headers, body: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      if (url.includes("rupload.facebook.com")) return new Response(JSON.stringify({ success: true }), { status: 200 });
      const phase = new URLSearchParams(String(init?.body ?? "")).get("upload_phase");
      if (phase === "start") return new Response(JSON.stringify({ video_id: "777", upload_url: "https://rupload.facebook.com/video-upload/v1.0/777" }), { status: 200 });
      if (phase === "finish") return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "ukjent", code: 100 } }), { status: 400 });
    }) as typeof fetch;
    const c = new GraphClient({ appId: "1", appSecret: "s", version: "v1.0", fetchImpl });
    const r = await c.publishReel("123", "EAApage", { fileUrl: "https://lagring.example/v.mp4?token=x", description: "Laseren i arbeid" });
    expect(r.videoId).toBe("777");
    expect(calls[0]!.url).toContain("/v1.0/123/video_reels");
    expect(calls[1]!.url).toBe("https://rupload.facebook.com/video-upload/v1.0/777");
    expect(calls[1]!.headers.file_url).toBe("https://lagring.example/v.mp4?token=x");
    expect(calls[1]!.headers.authorization).toBe("OAuth EAApage");
    expect(calls[2]!.body).toMatchObject({ upload_phase: "finish", video_id: "777", video_state: "PUBLISHED", description: "Laseren i arbeid" });
  });

  it("vanlig video sendes til graph-video med file_url", async () => {
    let seen = "";
    let body: Record<string, string> = {};
    const fetchImpl = (async (u: string | URL, init?: RequestInit) => {
      seen = String(u);
      body = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
      return new Response(JSON.stringify({ id: "888" }), { status: 200 });
    }) as typeof fetch;
    const c = new GraphClient({ appId: "1", appSecret: "s", version: "v1.0", fetchImpl });
    expect(await c.publishVideo("123", "t", { fileUrl: "https://x/v.mp4", description: "Hei" })).toEqual({ id: "888" });
    expect(seen).toBe("https://graph-video.facebook.com/v1.0/123/videos");
    expect(body.file_url).toBe("https://x/v.mp4");
  });
});
