import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { DB_URL, as, createUser, pool, resetDatabase } from "../helpers/db";
import { postContentHash } from "@/lib/posts/content-hash";

const run = DB_URL ? describe : describe.skip;

run("Database: RLS, godkjenning og publiseringsvern", () => {
  let p: Pool;
  let owner: string;
  let stranger: string;
  const O = () => ({ kind: "authenticated" as const, sub: owner });

  beforeAll(async () => {
    await resetDatabase();
    p = pool();
    owner = await createUser(p, "eier@example.com", true);
    stranger = await createUser(p, "fremmed@example.com", false);
  });
  afterAll(async () => {
    await p?.end();
  });
  beforeEach(async () => {
    await as(p, { kind: "superuser" }, (c) => c.query("truncate posts, publish_attempts, post_history, products, audit_log, facebook_connections, media_assets, contests cascade"));
  });

  async function newPost(fields: Record<string, unknown> = {}) {
    return as(p, O(), async (c) => {
      const f = { title: "Hei", content: "Tekst", hashtags: ["#a"], link_url: "https://myhrtreogdesign.com/", status: "PENDING_APPROVAL", generated_by: "owner", ...fields };
      const { rows } = await c.query("insert into posts (title, content, hashtags, link_url, status, generated_by) values ($1,$2,$3,$4,$5,$6) returning *", [f.title, f.content, f.hashtags, f.link_url, f.status, f.generated_by]);
      return rows[0];
    });
  }
  const approve = (id: string, by = owner) => as(p, { kind: "authenticated", sub: by }, (c) => c.query("update posts set status='APPROVED', approved_by=$2 where id=$1 returning *", [id, by]).then((r) => r.rows[0]));
  const get = (id: string) => as(p, { kind: "superuser" }, (c) => c.query("select * from posts where id=$1", [id]).then((r) => r.rows[0]));

  it("SQL- og TypeScript-hash er identiske", async () => {
    const sample = { title: "Æ ø å «test»", content: "Linje 1\nLinje 2 😀", hashtags: ["#én", "#to"], link_url: "https://myhrtreogdesign.com/x", image_path: "products/a.jpg" };
    const { rows } = await as(p, { kind: "superuser" }, (c) => c.query("select post_content_hash($1,$2,$3,$4,$5) h", [sample.title, sample.content, sample.hashtags, sample.link_url, sample.image_path]));
    expect(rows[0].h).toBe(postContentHash(sample));
    const { rows: r2 } = await as(p, { kind: "superuser" }, (c) => c.query("select post_content_hash(null,'',null,null,null) h"));
    expect(r2[0].h).toBe(postContentHash({ title: null, content: "", hashtags: null, link_url: null, image_path: null }));
  });

  describe("Tilgangskontroll (test 1–2)", () => {
    it("anonym bruker får ikke lese eller skrive noe", async () => {
      await newPost();
      for (const t of ["posts", "products", "business_settings", "facebook_connections", "users", "audit_log"]) {
        await expect(as(p, { kind: "anon" }, (c) => c.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
      }
      await expect(as(p, { kind: "anon" }, (c) => c.query("select is_owner()"))).rejects.toThrow(/permission denied/);
    });

    it("innlogget bruker som ikke er eier ser ingen data og kan ikke skrive", async () => {
      await newPost();
      const rows = await as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("select * from posts").then((r) => r.rows));
      expect(rows).toHaveLength(0);
      const settings = await as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("select * from business_settings").then((r) => r.rows));
      expect(settings).toHaveLength(0);
      await expect(as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("insert into posts (content) values ('x')"))).rejects.toThrow(/row-level security/);
      const status = await as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("select * from get_facebook_status()").then((r) => r.rows));
      expect(status).toHaveLength(0);
    });

    it("eier har tilgang til egne data, men aldri direkte til Facebook-tokens", async () => {
      await newPost();
      const rows = await as(p, O(), (c) => c.query("select * from posts").then((r) => r.rows));
      expect(rows).toHaveLength(1);
      await expect(as(p, O(), (c) => c.query("select encrypted_access_token from facebook_connections"))).rejects.toThrow(/permission denied/);
      await as(p, { kind: "service" }, (c) => c.query("insert into facebook_connections (page_id, page_name, encrypted_access_token) values ('1','Myhr','v1.x.y.z')"));
      const status = await as(p, O(), (c) => c.query("select * from get_facebook_status()").then((r) => r.rows));
      expect(status[0]).toMatchObject({ page_id: "1", page_name: "Myhr", connection_status: "connected" });
      expect(Object.keys(status[0])).not.toContain("encrypted_access_token");
    });

    it("revisjonsloggen kan ikke endres eller slettes", async () => {
      await as(p, O(), (c) => c.query("insert into audit_log (actor_id, action) values ($1, 'test')", [owner]));
      await expect(as(p, O(), (c) => c.query("update audit_log set action='endret'"))).rejects.toThrow(/permission denied/);
      await expect(as(p, O(), (c) => c.query("delete from audit_log"))).rejects.toThrow(/permission denied/);
    });

    it("lagring: kun eier kan laste opp til media-bøtta", async () => {
      await as(p, O(), (c) => c.query("insert into storage.objects (bucket_id, name) values ('media','a.jpg')"));
      await expect(as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("insert into storage.objects (bucket_id, name) values ('media','b.jpg')"))).rejects.toThrow(/row-level security/);
    });
  });

  describe("Godkjenning (test 6–8)", () => {
    it("AI-innhold tvinges til PENDING_APPROVAL selv om noe annet oppgis", async () => {
      const post = await newPost({ status: "DRAFT", generated_by: "ai" });
      expect(post.status).toBe("PENDING_APPROVAL");
    });

    it("nye innlegg kan ikke opprettes som godkjent eller publisert", async () => {
      await expect(newPost({ status: "APPROVED" })).rejects.toThrow(/DRAFT eller PENDING_APPROVAL/);
      await expect(newPost({ status: "PUBLISHED" })).rejects.toThrow(/DRAFT eller PENDING_APPROVAL/);
      await expect(as(p, O(), (c) => c.query("insert into posts (content, approved_at, approved_by, approved_content_hash) values ('x', now(), $1, 'h')", [owner]))).rejects.toThrow(/forhåndsgodkjent/);
    });

    it("utkast kan godkjennes av eier – databasen setter tidspunkt og hash", async () => {
      const post = await newPost();
      const a = await approve(post.id);
      expect(a.status).toBe("APPROVED");
      expect(a.approved_at).not.toBeNull();
      expect(a.approved_content_hash).toBe(postContentHash(a));
    });

    it("godkjenning krever at approved_by er den innloggede eieren", async () => {
      const post = await newPost();
      await expect(as(p, O(), (c) => c.query("update posts set status='APPROVED', approved_by=$2 where id=$1", [post.id, stranger]))).rejects.toThrow(/autorisert eier|eget navn/);
      await expect(as(p, O(), (c) => c.query("update posts set status='APPROVED' where id=$1", [post.id]))).rejects.toThrow(/autorisert eier/);
    });

    it("innlegg kan redigeres, og endringen loggføres", async () => {
      const post = await newPost();
      await as(p, O(), (c) => c.query("update posts set content='Ny tekst' where id=$1", [post.id]));
      const hist = await as(p, O(), (c) => c.query("select * from post_history where post_id=$1", [post.id]).then((r) => r.rows));
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ previous_content: "Tekst", new_content: "Ny tekst", approval_revoked: false });
    });

    it("endring av tekst etter godkjenning opphever godkjenningen", async () => {
      const post = await newPost();
      await approve(post.id);
      await as(p, O(), (c) => c.query("update posts set content='Endret etter godkjenning' where id=$1", [post.id]));
      const after = await get(post.id);
      expect(after.status).toBe("PENDING_APPROVAL");
      expect(after.approved_at).toBeNull();
      expect(after.approved_content_hash).toBeNull();
      const hist = await as(p, O(), (c) => c.query("select approval_revoked from post_history where post_id=$1", [post.id]).then((r) => r.rows));
      expect(hist[0].approval_revoked).toBe(true);
    });

    it("endring av bilde, lenke eller emneknagger på et PLANLAGT innlegg opphever godkjenningen", async () => {
      for (const change of ["image_path='ny.jpg'", "link_url='https://myhrtreogdesign.com/annen'", "hashtags='{#ny}'"]) {
        const post = await newPost();
        await approve(post.id);
        await as(p, O(), (c) => c.query("update posts set status='SCHEDULED', scheduled_at=now()+interval '1 day' where id=$1", [post.id]));
        await as(p, O(), (c) => c.query(`update posts set ${change} where id=$1`, [post.id]));
        expect((await get(post.id)).status).toBe("PENDING_APPROVAL");
      }
    });

    it("flytting av publiseringstidspunkt beholder godkjenningen", async () => {
      const post = await newPost();
      await approve(post.id);
      await as(p, O(), (c) => c.query("update posts set status='SCHEDULED', scheduled_at=now()+interval '1 day' where id=$1", [post.id]));
      await as(p, O(), (c) => c.query("update posts set scheduled_at=now()+interval '3 day' where id=$1", [post.id]));
      expect((await get(post.id)).status).toBe("SCHEDULED");
    });

    it("godkjenningsfelter kan ikke manipuleres direkte", async () => {
      const post = await newPost();
      await approve(post.id);
      await expect(as(p, O(), (c) => c.query("update posts set approved_content_hash='falsk' where id=$1", [post.id]))).rejects.toThrow(/Godkjenningsfelter/);
    });

    it("innhold kan ikke endres i samme operasjon som godkjenning", async () => {
      const post = await newPost();
      await expect(as(p, O(), (c) => c.query("update posts set status='APPROVED', approved_by=$2, content='snik' where id=$1", [post.id, owner]))).rejects.toThrow(/samme operasjon/);
    });

    it("kun godkjente innlegg kan planlegges", async () => {
      const post = await newPost();
      await expect(as(p, O(), (c) => c.query("update posts set status='SCHEDULED', scheduled_at=now()+interval '1 day' where id=$1", [post.id]))).rejects.toThrow(/Kun godkjente/);
    });
  });

  describe("Publiseringsvern (test 9–11)", () => {
    it("ikke-godkjente innlegg kan aldri settes til PUBLISHING eller PUBLISHED", async () => {
      const post = await newPost();
      await expect(as(p, O(), (c) => c.query("update posts set status='PUBLISHING' where id=$1", [post.id]))).rejects.toThrow(/Kun godkjente/);
      await expect(as(p, O(), (c) => c.query("update posts set status='PUBLISHED', facebook_post_id='1', published_at=now() where id=$1", [post.id]))).rejects.toThrow();
      await expect(as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]))).rejects.toThrow(/kan ikke publiseres/);
      await expect(as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'simulated')", [post.id]))).rejects.toThrow(/kan ikke publiseres/);
    });

    it("selv service-rollen kan ikke publisere et ikke-godkjent innlegg", async () => {
      const post = await newPost();
      await expect(as(p, { kind: "service" }, (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]))).rejects.toThrow(/kan ikke publiseres/);
      await expect(as(p, { kind: "service" }, (c) => c.query("update posts set status='PUBLISHING' where id=$1", [post.id]))).rejects.toThrow(/Kun godkjente/);
    });

    it("godkjent innlegg kan låses og publiseres med bekreftet Facebook-ID", async () => {
      const post = await newPost();
      await approve(post.id);
      const attempt = await as(p, O(), (c) => c.query("select * from claim_post_for_publishing($1,'live')", [post.id]).then((r) => r.rows[0]));
      expect(attempt.state).toBe("in_progress");
      expect((await get(post.id)).status).toBe("PUBLISHING");
      await expect(as(p, O(), (c) => c.query("update posts set status='PUBLISHED' where id=$1", [post.id]))).rejects.toThrow();
      await as(p, O(), (c) => c.query("update posts set status='PUBLISHED', facebook_post_id='123_456', published_at=now() where id=$1", [post.id]));
      expect((await get(post.id)).status).toBe("PUBLISHED");
    });

    it("dobbeltpublisering hindres: nytt forsøk mens ett pågår eller etter suksess avvises", async () => {
      const post = await newPost();
      await approve(post.id);
      await as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]));
      await expect(as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]))).rejects.toThrow(/kan ikke publiseres med status PUBLISHING/);
      // Selv om statusen tvinges tilbake, stopper idempotensnøkkelen et nytt forsøk.
      await as(p, { kind: "superuser" }, async (c) => {
        await c.query("alter table posts disable trigger posts_before_update");
        await c.query("update posts set status='APPROVED' where id=$1", [post.id]);
        await c.query("alter table posts enable trigger posts_before_update");
      });
      await expect(as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]))).rejects.toThrow(/pågår, er uavklart eller er allerede fullført/);
    });

    it("samtidige publiseringsforsøk: kun ett lykkes", async () => {
      const post = await newPost();
      await approve(post.id);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const attempts = await as(p, O(), (c) => c.query("select * from publish_attempts where post_id=$1", [post.id]).then((r) => r.rows));
      expect(attempts).toHaveLength(1);
    });

    it("publiserte innlegg er låst og kan ikke slettes", async () => {
      const post = await newPost();
      await approve(post.id);
      await as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]));
      await as(p, O(), (c) => c.query("update posts set status='PUBLISHED', facebook_post_id='1_2', published_at=now() where id=$1", [post.id]));
      await expect(as(p, O(), (c) => c.query("update posts set content='endret' where id=$1", [post.id]))).rejects.toThrow(/Publiserte innlegg kan ikke endres/);
      await expect(as(p, O(), (c) => c.query("delete from posts where id=$1", [post.id]))).rejects.toThrow(/kan ikke slettes/);
    });

    it("simulert publisering kontrollerer godkjenning, men endrer ikke status", async () => {
      const post = await newPost();
      await approve(post.id);
      const a = await as(p, O(), (c) => c.query("select * from claim_post_for_publishing($1,'simulated')", [post.id]).then((r) => r.rows[0]));
      expect(a.mode).toBe("simulated");
      expect((await get(post.id)).status).toBe("APPROVED");
      // Kan simuleres flere ganger og blokkerer ikke senere ekte publisering.
      await as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'simulated')", [post.id]));
      await as(p, O(), (c) => c.query("select claim_post_for_publishing($1,'live')", [post.id]));
      expect((await get(post.id)).status).toBe("PUBLISHING");
    });

    it("facebook_post_id kan ikke settes utenom publisering", async () => {
      const post = await newPost();
      await expect(as(p, O(), (c) => c.query("update posts set facebook_post_id='x' where id=$1", [post.id]))).rejects.toThrow(/kun settes ved publisering/);
    });
  });

  it("Facebook-innlegg fra siden: kun eier kan lese, ingen kan skrive via appen", async () => {
    await as(p, { kind: "service" }, (c) => c.query("insert into facebook_page_posts (page_id, facebook_post_id, message, created_time) values ('1','1_99','Hei fra siden', now())"));
    const own = await as(p, O(), (c) => c.query("select message from facebook_page_posts").then((r) => r.rows));
    expect(own).toEqual([{ message: "Hei fra siden" }]);
    const other = await as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("select * from facebook_page_posts").then((r) => r.rows));
    expect(other).toHaveLength(0);
    await expect(as(p, { kind: "anon" }, (c) => c.query("select * from facebook_page_posts"))).rejects.toThrow(/permission denied/);
    await expect(as(p, O(), (c) => c.query("insert into facebook_page_posts (page_id, facebook_post_id, created_time) values ('1','1_2', now())"))).rejects.toThrow(/permission denied/);
  });

  it("mediebank: eier kan lagre beskrivelse, ugyldig status avvises, fremmede ser ingenting", async () => {
    const id = await as(p, O(), (c) => c.query("insert into media_assets (storage_path, kind, in_library, analysis_status) values ('uploads/x.jpg','upload', true, 'pending') returning id").then((r) => r.rows[0].id));
    await as(p, O(), (c) => c.query("update media_assets set description='Verksted', tags='{laser}', category='verksted', analysis_status='done' where id=$1", [id]));
    await expect(as(p, O(), (c) => c.query("update media_assets set analysis_status='tull' where id=$1", [id]))).rejects.toThrow(/analysis_status_check/);
    const other = await as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("select * from media_assets").then((r) => r.rows));
    expect(other).toHaveLength(0);
  });

  it("engasjement og type for sidens innlegg kan lagres av serveren og leses av eier", async () => {
    await as(p, { kind: "service" }, (c) => c.query("insert into facebook_page_posts (page_id, facebook_post_id, message, created_time, reactions, comments, shares, post_type) values ('1','1_77','Hei', now(), 10, 2, 1, 'handverk')"));
    const r = await as(p, O(), (c) => c.query("select reactions, comments, shares, post_type from facebook_page_posts where facebook_post_id='1_77'").then((x) => x.rows[0]));
    expect(r).toEqual({ reactions: 10, comments: 2, shares: 1, post_type: "handverk" });
    await expect(as(p, O(), (c) => c.query("update facebook_page_posts set reactions=999"))).rejects.toThrow(/permission denied/);
  });

  it("konkurranser: kun eier, gyldige datoer, innlegg kobles og overlever sletting", async () => {
    const cid = await as(p, O(), (c) =>
      c.query("insert into contests (title, prize, starts_at, ends_at, announce_at) values ('Vinn', 'Flis', now(), now() + interval '7 day', now() + interval '8 day') returning id").then((r) => r.rows[0].id),
    );
    await expect(as(p, O(), (c) => c.query("insert into contests (title, prize, starts_at, ends_at, announce_at) values ('Feil', 'Flis', now(), now() - interval '1 day', now())"))).rejects.toThrow(/contest_dates_valid/);
    const other = await as(p, { kind: "authenticated", sub: stranger }, (c) => c.query("select * from contests").then((r) => r.rows));
    expect(other).toHaveLength(0);
    await expect(as(p, { kind: "anon" }, (c) => c.query("select * from contests"))).rejects.toThrow(/permission denied/);
    const post = await as(p, O(), (c) => c.query("insert into posts (content, contest_id, contest_role, generated_by) values ('Konkurranse', $1, 'kunngjoring', 'ai') returning id, status", [cid]).then((r) => r.rows[0]));
    expect(post.status).toBe("PENDING_APPROVAL");
    await expect(as(p, O(), (c) => c.query("insert into posts (content, contest_id, contest_role) values ('x', $1, 'ugyldig')", [cid]))).rejects.toThrow(/posts_contest_role_check/);
    await as(p, O(), (c) => c.query("delete from contests where id=$1", [cid]));
    const after = await as(p, O(), (c) => c.query("select contest_id from posts where id=$1", [post.id]).then((r) => r.rows[0]));
    expect(after.contest_id).toBeNull();
  });

  it("sporingskoder: standardverdier og validering", async () => {
    const row = await as(p, O(), (c) => c.query("select utm_enabled, utm_source, utm_medium from business_settings").then((r) => r.rows[0]));
    expect(row).toEqual({ utm_enabled: true, utm_source: "facebook", utm_medium: "social" });
    await expect(as(p, O(), (c) => c.query("update business_settings set utm_source='ugyldig kilde!'"))).rejects.toThrow(/utm_values_valid/);
  });

  it("rate limiting slår inn etter grensen", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await as(p, O(), (c) => c.query("select check_rate_limit('test-key', 3, 60) ok").then((r) => r.rows[0].ok)));
    expect(results).toEqual([true, true, true, false]);
  });

  it("kun én aktiv Facebook-tilkobling om gangen, og token kreves når tilkoblet", async () => {
    await as(p, { kind: "service" }, (c) => c.query("insert into facebook_connections (page_id, page_name, encrypted_access_token) values ('1','A','v1.a.b.c')"));
    await expect(as(p, { kind: "service" }, (c) => c.query("insert into facebook_connections (page_id, page_name, encrypted_access_token) values ('2','B','v1.a.b.c')"))).rejects.toThrow(/duplicate key/);
    await expect(as(p, { kind: "service" }, (c) => c.query("update facebook_connections set encrypted_access_token=null"))).rejects.toThrow(/token_required/);
    await as(p, { kind: "service" }, (c) => c.query("update facebook_connections set connection_status='disconnected', encrypted_access_token=null"));
    await as(p, { kind: "service" }, (c) => c.query("insert into facebook_connections (page_id, page_name, encrypted_access_token) values ('2','B','v1.a.b.c')"));
  });
});
