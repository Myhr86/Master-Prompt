import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, MEDIA_BUCKET } from "../supabase/admin";
import { getConnectionSecret, setConnectionStatus } from "../facebook/connection";
import type { PublishAttempt, PublishStore, PublishablePost } from "./publisher";

const POST_FIELDS = "id, title, content, hashtags, link_url, image_path, status, approved_at, approved_content_hash, facebook_post_id, facebook_post_url";

/**
 * Supabase-implementasjon av PublishStore.
 * `db` er enten eierens klient (RLS) ved manuell publisering, eller
 * service-klienten for planlagte publiseringer fra cron.
 */
export function supabasePublishStore(db: SupabaseClient): PublishStore {
  const admin = createAdminClient();
  return {
    async getPost(id) {
      const { data, error } = await db.from("posts").select(POST_FIELDS).eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as PublishablePost | null) ?? null;
    },
    async claim(postId, mode) {
      const { data, error } = await db.rpc("claim_post_for_publishing", { p_post_id: postId, p_mode: mode });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as PublishAttempt;
    },
    async latestAttempt(postId) {
      const { data, error } = await db
        .from("publish_attempts")
        .select("id, post_id, state, mode, started_at")
        .eq("post_id", postId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as PublishAttempt | null) ?? null;
    },
    async completeAttempt(attemptId, state, info) {
      const { error } = await db
        .from("publish_attempts")
        .update({
          state,
          facebook_post_id: info.facebookPostId ?? null,
          error: info.error ?? null,
          page_id: info.pageId ?? null,
          finished_at: state === "unknown" ? null : new Date().toISOString(),
        })
        .eq("id", attemptId);
      if (error) throw error;
    },
    async markPublished(postId, facebookPostId, url) {
      const { error } = await db
        .from("posts")
        .update({ status: "PUBLISHED", facebook_post_id: facebookPostId, facebook_post_url: url, published_at: new Date().toISOString(), publish_error: null })
        .eq("id", postId);
      if (error) throw error;
    },
    async markFailed(postId, message) {
      const { error } = await db.from("posts").update({ status: "FAILED", publish_error: message }).eq("id", postId).eq("status", "PUBLISHING");
      if (error) throw error;
    },
    getConnection: getConnectionSecret,
    setConnectionStatus,
    async imageUrl(path) {
      // Kortlevd signert URL som Facebook kan hente bildet fra.
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 30);
      if (error || !data) return null;
      return data.signedUrl;
    },
  };
}
