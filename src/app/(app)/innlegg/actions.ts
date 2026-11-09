"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { audit } from "@/lib/audit";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";
import { moveSchema, parseHashtags, postEditSchema, scheduleSchema, uuidSchema } from "@/lib/posts/validation";
import { APPROVABLE_STATUSES } from "@/lib/posts/status";
import { publishPost } from "@/lib/posts/publisher";
import { supabasePublishStore } from "@/lib/posts/supabase-store";
import { graphClient } from "@/lib/facebook/connection";
import { effectivePublishMode } from "@/lib/posts/mode";
import { getPost, getProducts, getSettings } from "@/lib/data";
import { rewritePost } from "@/lib/ai/generator";
import { callClaudeStructured } from "@/lib/ai/claude";
import { postcheck } from "@/lib/ai/postcheck";
import { osloParts, osloToUtc } from "@/lib/dates";
import { createImageForPost } from "@/lib/images/service";
import type { Post } from "@/lib/types";
import { markMediaUsed } from "@/lib/media/usage";
import { utmFromSettings, withUtm } from "@/lib/posts/utm";
import { enforceContestText } from "@/lib/contests/server";
import { randomUUID } from "node:crypto";

function refresh(id?: string) {
  revalidatePath("/", "layout");
  if (id) revalidatePath(`/innlegg/${id}`);
}

async function loadOrFail(id: string): Promise<Post> {
  const post = await getPost(id);
  if (!post) throw new UserFacingError("Fant ikke innlegget.");
  return post;
}

/** Lagre redigering. Databasen opphever godkjenning automatisk hvis innholdet endres. */
export async function updatePost(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const input = postEditSchema.parse({
      id: formData.get("id"),
      title: formData.get("title") ?? "",
      content: formData.get("content") ?? "",
      hashtags: parseHashtags(String(formData.get("hashtags") ?? "")),
      link_url: formData.get("link_url") ?? "",
      product_id: formData.get("product_id") ?? "",
    });
    const before = await loadOrFail(input.id);
    const settings = await getSettings();
    // Lenker til nettbutikken får sporingskode (vises i forhåndsvisningen før godkjenning).
    const link = withUtm(input.link_url, settings.website, { settings: utmFromSettings(settings), campaign: before.post_type ?? "manuelt", postId: input.id });
    const supabase = await createClient();
    // Konkurranseinnlegg: vilkårene beholdes og teksten kontrolleres mot Facebooks regler.
    const contest = await enforceContestText(supabase, { contest_id: before.contest_id ?? null, contest_role: before.contest_role ?? null }, input, settings.business_name);
    const { data, error } = await supabase
      .from("posts")
      .update({
        title: input.title,
        content: contest?.content ?? input.content,
        hashtags: input.hashtags,
        link_url: link,
        product_id: input.product_id,
        ...(contest ? { verification_notes: contest.warnings } : {}),
      })
      .eq("id", input.id)
      .select("status, approved_at")
      .single();
    if (error) throw error;
    const revoked = Boolean(before.approved_at) && !data.approved_at;
    await audit("post.edited", { actorId: owner.id, entity: "post", entityId: input.id, details: { approvalRevoked: revoked } });
    refresh(input.id);
    return { ok: true, message: revoked ? "Lagret. Godkjenningen er opphevet fordi innholdet ble endret – godkjenn på nytt." : "Endringene er lagret." };
  } catch (err) {
    return toActionError(err, "updatePost");
  }
}

export async function approvePost(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const post = await loadOrFail(id);
    if (!APPROVABLE_STATUSES.includes(post.status)) throw new UserFacingError("Innlegget kan ikke godkjennes i nåværende status.");
    if (!post.content.trim()) throw new UserFacingError("Innlegget mangler tekst.");
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ status: "APPROVED", approved_by: owner.id }).eq("id", id).in("status", APPROVABLE_STATUSES);
    if (error) throw error;
    await audit("post.approved", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: "Innlegget er godkjent. Publiser nå eller velg et tidspunkt." };
  } catch (err) {
    return toActionError(err, "approvePost");
  }
}

export async function revokeApproval(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ status: "PENDING_APPROVAL" }).eq("id", id).in("status", ["APPROVED", "SCHEDULED", "FAILED"]);
    if (error) throw error;
    await audit("post.approval_revoked", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: "Godkjenningen er trukket tilbake." };
  } catch (err) {
    return toActionError(err, "revokeApproval");
  }
}

export async function rejectPost(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ status: "REJECTED" }).eq("id", id).in("status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "FAILED"]);
    if (error) throw error;
    await audit("post.rejected", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: "Innlegget er avvist." };
  } catch (err) {
    return toActionError(err, "rejectPost");
  }
}

export async function deletePost(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { error, count } = await supabase.from("posts").delete({ count: "exact" }).eq("id", id).not("status", "in", "(PUBLISHED,PUBLISHING)");
    if (error) throw error;
    if (!count) throw new UserFacingError("Innlegget kunne ikke slettes (publiserte innlegg kan ikke slettes).");
    await audit("post.deleted", { actorId: owner.id, entity: "post", entityId: id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Utkastet er slettet." };
  } catch (err) {
    return toActionError(err, "deletePost");
  }
}

export async function schedulePost(id: string, scheduledAtIso: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const input = scheduleSchema.parse({ id, scheduled_at: scheduledAtIso });
    const post = await loadOrFail(id);
    if (!["APPROVED", "SCHEDULED", "FAILED"].includes(post.status)) throw new UserFacingError("Godkjenn innlegget før du planlegger det.");
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ status: "SCHEDULED", scheduled_at: input.scheduled_at }).eq("id", id);
    if (error) throw error;
    await audit("post.scheduled", { actorId: owner.id, entity: "post", entityId: id, details: { scheduled_at: input.scheduled_at } });
    refresh(id);
    return { ok: true, message: "Innlegget er planlagt." };
  } catch (err) {
    return toActionError(err, "schedulePost");
  }
}

export async function unschedulePost(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ status: "APPROVED" }).eq("id", id).eq("status", "SCHEDULED");
    if (error) throw error;
    await audit("post.unscheduled", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: "Planleggingen er fjernet. Innlegget er fortsatt godkjent." };
  } catch (err) {
    return toActionError(err, "unschedulePost");
  }
}

/** Separat handling fra godkjenning. Publiserer kun et allerede godkjent innlegg. */
export async function publishNow(id: string): Promise<ActionResult<{ url: string | null; simulated: boolean }>> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    await enforceRateLimit(`publish:${owner.id}`, 10, 60);
    const settings = await getSettings();
    const mode = effectivePublishMode(settings.test_mode);
    const supabase = await createClient();
    const result = await publishPost(id, { store: supabasePublishStore(supabase), graph: graphClient(), mode });
    await audit(result.ok ? (result.simulated ? "post.publish_simulated" : "post.published") : "post.publish_failed", {
      actorId: owner.id,
      entity: "post",
      entityId: id,
      details: result.ok ? { facebookPostId: result.facebookPostId, mode } : { reason: result.reason, mode },
    });
    refresh(id);
    if (!result.ok) return { ok: false, error: result.message };
    return { ok: true, message: result.message, data: { url: result.url, simulated: result.simulated } };
  } catch (err) {
    return toActionError(err, "publishNow");
  }
}

/** Kalender: flytt til ny dato, behold klokkeslett. */
export async function movePost(id: string, date: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const input = moveSchema.parse({ id, date });
    const post = await loadOrFail(id);
    if (["PUBLISHED", "PUBLISHING"].includes(post.status)) throw new UserFacingError("Publiserte innlegg kan ikke flyttes.");
    const time = post.scheduled_at ? (() => { const p = osloParts(new Date(post.scheduled_at)); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; })() : "19:00";
    const when = osloToUtc(input.date, time);
    if (post.status === "SCHEDULED" && when.getTime() < Date.now() + 60_000) throw new UserFacingError("Et planlagt innlegg kan ikke flyttes til et tidspunkt som har passert.");
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ scheduled_at: when.toISOString() }).eq("id", id);
    if (error) throw error;
    await audit("post.moved", { actorId: owner.id, entity: "post", entityId: id, details: { to: when.toISOString() } });
    refresh(id);
    return { ok: true, message: "Innlegget er flyttet." };
  } catch (err) {
    return toActionError(err, "movePost");
  }
}

/** Setter ønsket tidspunkt uten å planlegge publisering (for utkast). */
export async function setDesiredTime(id: string, iso: string): Promise<ActionResult> {
  try {
    await requireOwner();
    uuidSchema.parse(id);
    const when = z.string().datetime({ offset: true }).parse(iso);
    const post = await loadOrFail(id);
    if (post.status === "SCHEDULED") return schedulePost(id, when);
    if (["PUBLISHED", "PUBLISHING"].includes(post.status)) throw new UserFacingError("Publiserte innlegg kan ikke endres.");
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ scheduled_at: when }).eq("id", id);
    if (error) throw error;
    refresh(id);
    return { ok: true, message: "Ønsket tidspunkt er lagret." };
  } catch (err) {
    return toActionError(err, "setDesiredTime");
  }
}

export async function regenerateText(id: string, instructions: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const instr = z.string().max(1500).parse(instructions ?? "");
    await enforceRateLimit(`ai:${owner.id}`, 20, 3600);
    const post = await loadOrFail(id);
    if (["PUBLISHED", "PUBLISHING"].includes(post.status)) throw new UserFacingError("Publiserte innlegg kan ikke endres.");
    const [settings, products] = await Promise.all([getSettings(), getProducts()]);
    const product = products.find((p) => p.id === post.product_id) ?? null;
    const result = await rewritePost({ settings, product, current: { title: post.title, content: post.content, hashtags: post.hashtags }, instructions: instr }, callClaudeStructured);
    const checked = postcheck(
      {
        post_type: "produktpresentasjon",
        title: result.title,
        body: result.body,
        call_to_action: result.call_to_action,
        link_url: post.link_url,
        product_id: post.product_id,
        hashtags: result.hashtags,
        image_suggestion: "",
        suggested_image_id: null,
        suggested_media_id: null,
        recommended_publish_at: post.scheduled_at ?? new Date(Date.now() + 864e5).toISOString(),
        rationale: result.rationale,
        variants: [],
        needs_verification: result.needs_verification,
        quality: { relevance: 3, language: 3, originality: 3, product_accuracy: 3, marketing_value: 3, visual_quality: 3, notes: "" },
      },
      0,
      { products, productImageIds: new Set(), website: settings.website, recentTexts: [], fallbackTimes: [], now: new Date(), defaultHashtags: [] },
    );
    const supabase = await createClient();
    const contest = await enforceContestText(supabase, { contest_id: post.contest_id ?? null, contest_role: post.contest_role ?? null }, { title: result.title, content: result.content }, settings.business_name);
    const { error } = await supabase
      .from("posts")
      .update({
        title: result.title,
        content: contest?.content ?? result.content,
        hashtags: result.hashtags,
        rationale: result.rationale,
        verification_notes: contest ? [...contest.warnings, ...checked.warnings.filter((w) => !/rabatt|tilbud/i.test(w))] : checked.warnings,
        ai_model: result.model,
      })
      .eq("id", id);
    if (error) throw error;
    await supabase.from("ai_generations").insert({ kind: "rewrite", model: result.model, status: "succeeded", request: { post_id: id, instructions: instr }, response: result, created_by: owner.id });
    await audit("post.text_regenerated", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: post.approved_at ? "Ny tekst er laget. Innlegget må godkjennes på nytt." : "Ny tekst er laget." };
  } catch (err) {
    return toActionError(err, "regenerateText");
  }
}

export async function applyVariant(id: string, index: number): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const post = await loadOrFail(id);
    const v = post.variants[index];
    if (!v) throw new UserFacingError("Fant ikke varianten.");
    const supabase = await createClient();
    const variants = [...post.variants];
    variants[index] = { title: post.title, content: post.content };
    const { error } = await supabase.from("posts").update({ title: v.title, content: v.content, variants }).eq("id", id);
    if (error) throw error;
    await audit("post.variant_applied", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: "Varianten er tatt i bruk." };
  } catch (err) {
    return toActionError(err, "applyVariant");
  }
}

/** Velg bilde fra bildebiblioteket eller produktbilder (eller fjern bildet). */
export async function setPostImage(id: string, source: { kind: "asset" | "product_image" | "none"; id?: string }): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    let image_path: string | null = null;
    let image_asset_id: string | null = null;
    if (source.kind === "asset") {
      const { data } = await supabase.from("media_assets").select("id, storage_path").eq("id", uuidSchema.parse(source.id)).single();
      if (!data) throw new UserFacingError("Fant ikke bildet.");
      image_path = data.storage_path;
      image_asset_id = data.id;
    } else if (source.kind === "product_image") {
      const { data } = await supabase.from("product_images").select("storage_path").eq("id", uuidSchema.parse(source.id)).single();
      if (!data) throw new UserFacingError("Fant ikke produktbildet.");
      image_path = data.storage_path;
    }
    const { error } = await supabase.from("posts").update({ image_path, image_asset_id }).eq("id", id);
    if (error) throw error;
    if (image_asset_id) await markMediaUsed(supabase, [image_asset_id]);
    await audit("post.image_changed", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: "Bildet er oppdatert. Hvis innlegget var godkjent, må det godkjennes på nytt." };
  } catch (err) {
    return toActionError(err, "setPostImage");
  }
}

export async function regenerateImage(id: string, instructions: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    await enforceRateLimit(`image:${owner.id}`, 20, 3600);
    const post = await loadOrFail(id);
    if (["PUBLISHED", "PUBLISHING"].includes(post.status)) throw new UserFacingError("Publiserte innlegg kan ikke endres.");
    const asset = await createImageForPost(post, z.string().max(1000).parse(instructions ?? ""), owner.id);
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ image_path: asset.storage_path, image_asset_id: asset.id }).eq("id", id);
    if (error) throw error;
    await audit("post.image_generated", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: asset.contains_real_product_photo ? "Nytt miljøbilde er laget med det ekte produktbildet." : "Nytt bilde er laget (AI-generert, merket som det)." };
  } catch (err) {
    return toActionError(err, "regenerateImage");
  }
}

export async function createManualPost(): Promise<ActionResult<{ id: string }>> {
  try {
    const owner = await requireOwner();
    const settings = await getSettings();
    const supabase = await createClient();
    const id = randomUUID();
    const { data, error } = await supabase
      .from("posts")
      .insert({
        id,
        title: "",
        content: "",
        hashtags: settings.default_hashtags,
        link_url: withUtm(settings.website, settings.website, { settings: utmFromSettings(settings), campaign: "manuelt", postId: id }),
        status: "DRAFT",
        generated_by: "owner",
      })
      .select("id")
      .single();
    if (error) throw error;
    await audit("post.created", { actorId: owner.id, entity: "post", entityId: data.id });
    revalidatePath("/innlegg");
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return toActionError(err, "createManualPost");
  }
}

export async function submitForApproval(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { error } = await supabase.from("posts").update({ status: "PENDING_APPROVAL" }).eq("id", id).in("status", ["DRAFT", "REJECTED"]);
    if (error) throw error;
    await audit("post.submitted", { actorId: owner.id, entity: "post", entityId: id });
    refresh(id);
    return { ok: true, message: "Innlegget venter nå på godkjenning." };
  } catch (err) {
    return toActionError(err, "submitForApproval");
  }
}

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Ugyldig tidspunkt");

/** Tar imot lokal Oslo-tid (fra datetime-local) og konverterer på serveren. */
export async function schedulePostLocal(id: string, local: string): Promise<ActionResult> {
  try {
    const [d, t] = localDateTime.parse(local).split("T") as [string, string];
    return schedulePost(id, osloToUtc(d, t).toISOString());
  } catch (err) {
    return toActionError(err, "schedulePostLocal");
  }
}

export async function setDesiredTimeLocal(id: string, local: string): Promise<ActionResult> {
  try {
    const [d, t] = localDateTime.parse(local).split("T") as [string, string];
    return setDesiredTime(id, osloToUtc(d, t).toISOString());
  } catch (err) {
    return toActionError(err, "setDesiredTimeLocal");
  }
}
