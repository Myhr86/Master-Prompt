import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { DB_URL, as, createUser, pool, resetDatabase } from "../helpers/db";
import { pgPublishStore } from "../helpers/pg-store";
import { fakeGraph } from "../helpers/fake-graph";
import { publishPost } from "@/lib/posts/publisher";

const run = DB_URL ? describe : describe.skip;
const CONN = { pageId: "1234", pageName: "Myhr Tre og Design", token: "EAAtesttoken", status: "connected", expiresAt: null };

run("Publisering mot ekte database og simulert Facebook (test 9–13)", () => {
  let p: Pool;
  let owner: string;
  const O = () => ({ kind: "authenticated" as const, sub: owner });

  beforeAll(async () => {
    await resetDatabase();
    p = pool();
    owner = await createUser(p, "eier@example.com", true);
  });
  afterAll(async () => {
    await p?.end();
  });
  beforeEach(async () => {
    await as(p, { kind: "superuser" }, (c) => c.query("truncate posts, publish_attempts, post_history cascade"));
  });

  const create = (fields: { image_path?: string | null; link_url?: string | null } = {}) =>
    as(p, O(), (c) =>
      c
        .query("insert into posts (title, content, hashtags, link_url, image_path, status) values ('Minner som varer','En personlig flis med familiens bilde.', '{#myhrtreogdesign}', $1, $2, 'PENDING_APPROVAL') returning id", [
          fields.link_url === undefined ? "https://myhrtreogdesign.com/" : fields.link_url,
          fields.image_path ?? null,
        ])
        .then((r) => r.rows[0].id as string),
    );
  const approve = (id: string) => as(p, O(), (c) => c.query("update posts set status='APPROVED', approved_by=$2 where id=$1", [id, owner]));
  const get = (id: string) => as(p, { kind: "superuser" }, (c) => c.query("select * from posts where id=$1", [id]).then((r) => r.rows[0]));

  it("ikke-godkjent innlegg publiseres aldri – Facebook kalles ikke", async () => {
    const id = await create();
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live", checkImage: async () => true });
    expect(r).toMatchObject({ ok: false, reason: "not_approved" });
    expect(fb.publishCalls()).toHaveLength(0);
    expect((await get(id)).status).toBe("PENDING_APPROVAL");
  });

  it("innlegg endret etter godkjenning kan ikke publiseres", async () => {
    const id = await create();
    await approve(id);
    await as(p, O(), (c) => c.query("update posts set content='Endret' where id=$1", [id]));
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live", checkImage: async () => true });
    expect(r).toMatchObject({ ok: false, reason: "not_approved" });
    expect(fb.publishCalls()).toHaveLength(0);
  });

  it("godkjent lenkeinnlegg publiseres, ID og URL lagres, status blir PUBLISHED", async () => {
    const id = await create();
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live", checkImage: async () => true });
    expect(r).toMatchObject({ ok: true, simulated: false, facebookPostId: "999_1", url: "https://www.facebook.com/999_1" });
    const calls = fb.publishCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("1234/feed");
    expect(calls[0]!.body.link).toBe("https://myhrtreogdesign.com/");
    expect(calls[0]!.body.message).toContain("Minner som varer");
    expect(calls[0]!.body.appsecret_proof).toMatch(/^[0-9a-f]{64}$/);
    const row = await get(id);
    expect(row).toMatchObject({ status: "PUBLISHED", facebook_post_id: "999_1", facebook_post_url: "https://www.facebook.com/999_1" });
    expect(row.published_at).not.toBeNull();
  });

  it("godkjent bildeinnlegg publiseres via /photos med lenken i teksten", async () => {
    const id = await create({ image_path: "products/flis.jpg" });
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live", checkImage: async () => true });
    expect(r.ok).toBe(true);
    const call = fb.publishCalls()[0]!;
    expect(call.path).toBe("1234/photos");
    expect(call.body.url).toBe("https://cdn.example/bilde.jpg");
    expect(call.body.caption).toContain("https://myhrtreogdesign.com/");
  });

  it("tekstinnlegg uten lenke og bilde støttes", async () => {
    const id = await create({ link_url: null });
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live" });
    expect(r.ok).toBe(true);
    expect(fb.publishCalls()[0]!.body.link).toBeUndefined();
  });

  it("dobbeltpublisering hindres – andre kall sender ingenting til Facebook", async () => {
    const id = await create();
    await approve(id);
    const fb = fakeGraph();
    const deps = { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live" as const, checkImage: async () => true };
    const first = await publishPost(id, deps);
    const second = await publishPost(id, deps);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, alreadyPublished: true });
    expect(fb.publishCalls()).toHaveLength(1);
  });

  it("samtidige klikk på «Publiser» gir kun ett innlegg hos Facebook", async () => {
    const id = await create();
    await approve(id);
    const fb = fakeGraph();
    const deps = { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live" as const };
    const results = await Promise.all([publishPost(id, deps), publishPost(id, deps), publishPost(id, deps)]);
    expect(fb.publishCalls()).toHaveLength(1);
    expect(results.filter((r) => r.ok && !r.alreadyPublished)).toHaveLength(1);
  });

  it("uklart resultat (tidsavbrudd) avklares mot Facebook før nytt forsøk – ingen duplikat", async () => {
    const id = await create();
    await approve(id);
    const fb = fakeGraph({ publish: "timeout-but-created" });
    const deps = { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live" as const };
    const r = await publishPost(id, deps);
    // Innlegget fantes hos Facebook – systemet oppdager det i stedet for å prøve på nytt.
    expect(r).toMatchObject({ ok: true, facebookPostId: "999_1" });
    expect(fb.publishCalls()).toHaveLength(1);
    expect((await get(id)).status).toBe("PUBLISHED");
  });

  it("uklart resultat der Facebook IKKE opprettet innlegget: markeres feilet og kan prøves igjen", async () => {
    const id = await create();
    await approve(id);
    const fbTimeout = fakeGraph({ publish: "timeout" });
    const store = pgPublishStore(p, owner, CONN);
    const r1 = await publishPost(id, { store, graph: fbTimeout.graph, mode: "live" });
    expect(r1.ok).toBe(false);
    expect((await get(id)).status).toBe("FAILED");
    const fbOk = fakeGraph();
    const r2 = await publishPost(id, { store, graph: fbOk.graph, mode: "live" });
    expect(r2.ok).toBe(true);
    expect(fbOk.publishCalls()).toHaveLength(1);
  });

  it("utløpt token håndteres: status FAILED, tilkobling merkes utløpt, tydelig melding", async () => {
    const id = await create();
    await approve(id);
    const fb = fakeGraph({ publish: "error-token" });
    const store = pgPublishStore(p, owner, CONN);
    const r = await publishPost(id, { store, graph: fb.graph, mode: "live" });
    expect(r).toMatchObject({ ok: false, reason: "token_expired" });
    expect(store.connectionStatus).toBe("expired");
    const row = await get(id);
    expect(row.status).toBe("FAILED");
    expect(row.approved_at).not.toBeNull(); // godkjenningen beholdes – kan publiseres etter ny tilkobling
  });

  it("manglende tillatelse fra Meta gir forståelig feil", async () => {
    const id = await create();
    await approve(id);
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fakeGraph({ publish: "error-permission" }).graph, mode: "live" });
    expect(r).toMatchObject({ ok: false, reason: "facebook_error" });
    expect(r.ok ? "" : r.message).toMatch(/tillatelse/);
  });

  it("frakoblet Facebook stopper publisering før noe sendes (test 13)", async () => {
    const id = await create();
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, null), graph: fb.graph, mode: "live" });
    expect(r).toMatchObject({ ok: false, reason: "not_connected" });
    expect(fb.publishCalls()).toHaveLength(0);
    expect((await get(id)).status).toBe("APPROVED");
  });

  it("utilgjengelig bilde stopper publisering", async () => {
    const id = await create({ image_path: "mangler.jpg" });
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live", checkImage: async () => false });
    expect(r).toMatchObject({ ok: false, reason: "image_unavailable" });
    expect(fb.publishCalls()).toHaveLength(0);
  });

  it("testmodus: simulert publisering sender ingenting og endrer ikke status", async () => {
    const id = await create();
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, null), graph: fb.graph, mode: "simulated" });
    expect(r).toMatchObject({ ok: true, simulated: true, facebookPostId: null });
    expect(fb.calls).toHaveLength(0);
    expect((await get(id)).status).toBe("APPROVED");
    const attempts = await as(p, O(), (c) => c.query("select mode, state from publish_attempts where post_id=$1", [id]).then((x) => x.rows));
    expect(attempts).toEqual([{ mode: "simulated", state: "succeeded" }]);
  });

  const addVideo = (path: string, w: number, h: number, dur: number) =>
    as(p, O(), (c) => c.query("insert into media_assets (storage_path, kind, media_type, width, height, duration_seconds, in_library) values ($1, 'upload', 'video', $2, $3, $4, true)", [path, w, h, dur]));

  it("stående kort video publiseres som Reel via Facebooks tretrinns opplasting", async () => {
    await addVideo("uploads/videos/2026/11/a.mp4", 1080, 1920, 25);
    const id = await create({ image_path: "uploads/videos/2026/11/a.mp4" });
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN, "https://lagring.example/a.mp4?sig=1"), graph: fb.graph, mode: "live", checkImage: async () => true, sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, simulated: false });
    expect(r.ok && r.message).toMatch(/Reelen er publisert/);
    const reel = fb.reelCalls();
    expect(reel.map((c) => c.body.upload_phase ?? c.method)).toEqual(["start", "RUPLOAD", "finish"]);
    expect(reel[1]!.body.file_url).toBe("https://lagring.example/a.mp4?sig=1");
    expect(reel[2]!.body.description).toContain("https://myhrtreogdesign.com/"); // lenken i teksten
    expect((await get(id)).status).toBe("PUBLISHED");
    expect((await get(id)).facebook_post_url).toContain("/reel/");
    await as(p, { kind: "superuser" }, (c) => c.query("delete from media_assets"));
  });

  it("liggende video publiseres som vanlig video", async () => {
    await addVideo("uploads/videos/2026/11/b.mp4", 1920, 1080, 40);
    const id = await create({ image_path: "uploads/videos/2026/11/b.mp4" });
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fb.graph, mode: "live", checkImage: async () => true, sleep: async () => {} });
    expect(r.ok).toBe(true);
    expect(fb.publishCalls().map((c) => c.path)).toEqual(["1234/videos"]);
    expect(fb.reelCalls()).toHaveLength(0);
    await as(p, { kind: "superuser" }, (c) => c.query("delete from media_assets"));
  });

  it("behandlingsfeil hos Facebook gir FAILED med forklaring", async () => {
    await addVideo("uploads/videos/2026/11/c.mp4", 1080, 1920, 20);
    const id = await create({ image_path: "uploads/videos/2026/11/c.mp4" });
    await approve(id);
    const r = await publishPost(id, { store: pgPublishStore(p, owner, CONN), graph: fakeGraph({ videoStatus: "error" }).graph, mode: "live", checkImage: async () => true, sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, reason: "facebook_error" });
    expect(r.ok ? "" : r.message).toMatch(/Ugyldig videoformat/);
    expect((await get(id)).status).toBe("FAILED");
    await as(p, { kind: "superuser" }, (c) => c.query("delete from media_assets"));
  });

  it("testmodus beskriver video som Reel uten å sende noe", async () => {
    await addVideo("uploads/videos/2026/11/d.mp4", 1080, 1920, 20);
    const id = await create({ image_path: "uploads/videos/2026/11/d.mp4" });
    await approve(id);
    const fb = fakeGraph();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, null), graph: fb.graph, mode: "simulated", checkImage: async () => true });
    expect(r.ok && r.message).toMatch(/reel/);
    expect(fb.calls).toHaveLength(0);
    await as(p, { kind: "superuser" }, (c) => c.query("delete from media_assets"));
  });

  it("testmodus avviser fortsatt ikke-godkjente innlegg", async () => {
    const id = await create();
    const r = await publishPost(id, { store: pgPublishStore(p, owner, null), graph: null, mode: "simulated" });
    expect(r).toMatchObject({ ok: false, reason: "not_approved" });
  });
});
