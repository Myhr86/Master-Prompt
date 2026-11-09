import type { Pool } from "pg";
import type { FacebookConnectionSecret, PublishAttempt, PublishStore, PublishablePost } from "@/lib/posts/publisher";
import { as } from "./db";

/**
 * PublishStore mot ekte PostgreSQL, kjørt som innlogget eier gjennom RLS –
 * speiler supabase-store.ts slik at publiseringslogikken testes mot de
 * faktiske databasereglene (triggere, statusmaskin, idempotens).
 */
export function pgPublishStore(p: Pool, ownerId: string, connection: FacebookConnectionSecret | null, imageUrl: string | null = "https://cdn.example/bilde.jpg"): PublishStore & { connectionStatus: string | null } {
  const role = { kind: "authenticated" as const, sub: ownerId };
  const store = {
    connectionStatus: null as string | null,
    async getPost(id: string) {
      return as(p, role, async (c) => {
        const { rows } = await c.query("select id, title, content, hashtags, link_url, image_path, status, approved_at, approved_content_hash, facebook_post_id, facebook_post_url from posts where id = $1", [id]);
        return (rows[0] as PublishablePost) ?? null;
      });
    },
    async claim(postId: string, mode: "live" | "simulated") {
      return as(p, role, async (c) => {
        const { rows } = await c.query("select * from claim_post_for_publishing($1, $2)", [postId, mode]);
        return rows[0] as PublishAttempt;
      });
    },
    async latestAttempt(postId: string) {
      return as(p, role, async (c) => {
        const { rows } = await c.query("select id, post_id, state, mode, started_at from publish_attempts where post_id = $1 order by started_at desc limit 1", [postId]);
        return (rows[0] as PublishAttempt) ?? null;
      });
    },
    async completeAttempt(attemptId: string, state: string, info: { facebookPostId?: string; error?: string; pageId?: string }) {
      await as(p, role, (c) => c.query("update publish_attempts set state = $2, facebook_post_id = $3, error = $4, page_id = $5, finished_at = case when $2 = 'unknown' then null else now() end where id = $1", [attemptId, state, info.facebookPostId ?? null, info.error ?? null, info.pageId ?? null]));
    },
    async markPublished(postId: string, fbId: string, url: string | null) {
      await as(p, role, (c) => c.query("update posts set status = 'PUBLISHED', facebook_post_id = $2, facebook_post_url = $3, published_at = now() where id = $1", [postId, fbId, url]));
    },
    async markFailed(postId: string, message: string) {
      await as(p, role, (c) => c.query("update posts set status = 'FAILED', publish_error = $2 where id = $1 and status = 'PUBLISHING'", [postId, message]));
    },
    async getConnection() {
      return connection && store.connectionStatus ? { ...connection, status: store.connectionStatus } : connection;
    },
    async setConnectionStatus(status: string) {
      store.connectionStatus = status;
    },
    async imageUrl() {
      return imageUrl;
    },
    async mediaInfo(path: string) {
      return as(p, role, async (c) => {
        const { rows } = await c.query("select media_type, duration_seconds, width, height from media_assets where storage_path = $1", [path]);
        const r = rows[0];
        return r ? { kind: r.media_type === "video" ? ("video" as const) : ("image" as const), durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds), width: r.width, height: r.height } : null;
      });
    },
  };
  return store as PublishStore & { connectionStatus: string | null };
}
