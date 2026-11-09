"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { audit } from "@/lib/audit";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";
import { sanitizeUpload, compositeProduct, textGraphic, toFormat, backgroundPrompt } from "@/lib/images/compose";
import { downloadMedia, removeMedia } from "@/lib/images/storage";
import { generateAiImage, plainBackground, saveAsset } from "@/lib/images/service";
import { IMAGE_FORMAT_KEYS } from "@/lib/images/formats";
import { uuidSchema } from "@/lib/posts/validation";
import type { MediaAsset } from "@/lib/types";

const format = z.enum(IMAGE_FORMAT_KEYS as [string, ...string[]]).transform((v) => v as (typeof IMAGE_FORMAT_KEYS)[number]);

function done(message: string): ActionResult {
  revalidatePath("/bilder");
  return { ok: true, message };
}

export async function uploadAssets(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`upload:${owner.id}`, 60, 3600);
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new UserFacingError("Velg minst ett bilde.");
    if (files.length > 10) throw new UserFacingError("Maks 10 bilder om gangen.");
    for (const f of files) {
      let clean;
      try {
        clean = await sanitizeUpload(Buffer.from(await f.arrayBuffer()));
      } catch (e) {
        throw new UserFacingError(`${f.name}: ${(e as Error).message}`);
      }
      await saveAsset({ data: clean.data, mime: clean.mimeType, folder: "uploads", kind: "upload", is_ai_generated: false, contains_real_product_photo: false, prompt: null, provider: null, format: "original", product_id: null, source_asset_id: null, source_product_image_id: null });
    }
    await audit("media.uploaded", { actorId: owner.id, details: { count: files.length } });
    return done(`${files.length} bilde(r) lastet opp.`);
  } catch (err) {
    return toActionError(err, "uploadAssets");
  }
}

export async function generateImage(input: { prompt: string; format: string; sourceAssetId?: string }): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`image:${owner.id}`, 20, 3600);
    const prompt = z.string().trim().min(5, "Beskriv bildet litt mer").max(1500).parse(input.prompt);
    const f = format.parse(input.format);
    const full = `${prompt}. Skandinavisk stil, varme naturfarger. Ingen tekst eller logoer. Ikke vis noe spesifikt kundeprodukt fra Myhr Tre og Design.`;
    const gen = await generateAiImage(full, f);
    await saveAsset({ data: gen.data, mime: "image/jpeg", folder: "generated", kind: "ai_generated", is_ai_generated: true, contains_real_product_photo: false, prompt: full, provider: gen.provider, format: f, product_id: null, source_asset_id: input.sourceAssetId ?? null, source_product_image_id: null });
    await audit("media.ai_generated", { actorId: owner.id });
    return done("Bildet er generert og merket som AI-generert.");
  } catch (err) {
    return toActionError(err, "generateImage");
  }
}

/** Miljøbilde: ekte produktfoto legges UENDRET oppå en bakgrunn. */
export async function createSceneImage(input: { productImageId: string; background: "ai" | "plain" | "asset"; backgroundAssetId?: string; scene?: string; format: string; scale: number; position: string }): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`image:${owner.id}`, 30, 3600);
    const f = format.parse(input.format);
    const scale = z.number().min(0.3).max(0.85).parse(input.scale);
    const position = z.enum(["center", "bottom", "left", "right"]).parse(input.position);
    const supabase = await createClient();
    const { data: photo } = await supabase.from("product_images").select("id, product_id, storage_path").eq("id", uuidSchema.parse(input.productImageId)).single();
    if (!photo) throw new UserFacingError("Fant ikke produktbildet.");

    let bg: Buffer;
    let provider: string | null = null;
    let prompt: string | null = null;
    if (input.background === "ai") {
      prompt = backgroundPrompt(z.string().trim().max(1000).parse(input.scene || "lys stue med eikebord"), f);
      const gen = await generateAiImage(prompt, f);
      bg = gen.data;
      provider = gen.provider;
    } else if (input.background === "asset") {
      const { data: a } = await supabase.from("media_assets").select("storage_path, is_ai_generated, provider").eq("id", uuidSchema.parse(input.backgroundAssetId)).single();
      if (!a) throw new UserFacingError("Fant ikke bakgrunnsbildet.");
      bg = await downloadMedia(a.storage_path);
      provider = a.is_ai_generated ? a.provider ?? "ai" : null;
    } else {
      bg = await plainBackground(f);
    }
    const out = await compositeProduct(bg, await downloadMedia(photo.storage_path), { format: f, scale, position });
    await saveAsset({ data: out, mime: "image/jpeg", folder: "composites", kind: "composite", is_ai_generated: Boolean(provider), contains_real_product_photo: true, prompt, provider, format: f, product_id: photo.product_id, source_asset_id: input.backgroundAssetId ?? null, source_product_image_id: photo.id });
    await audit("media.composite_created", { actorId: owner.id });
    return done("Miljøbildet er laget med det ekte produktbildet.");
  } catch (err) {
    return toActionError(err, "createSceneImage");
  }
}

export async function createTextGraphic(input: { headline: string; subline?: string; theme: string; format: string; backgroundAssetId?: string }): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const headline = z.string().trim().min(1, "Skriv en overskrift").max(120).parse(input.headline);
    const subline = z.string().trim().max(240).optional().parse(input.subline || undefined);
    const theme = z.enum(["light", "dark", "wood"]).parse(input.theme);
    const f = format.parse(input.format);
    const supabase = await createClient();
    let background: Buffer | undefined;
    let bgAsset: Pick<MediaAsset, "is_ai_generated" | "contains_real_product_photo" | "product_id"> | null = null;
    if (input.backgroundAssetId) {
      const { data } = await supabase.from("media_assets").select("storage_path, is_ai_generated, contains_real_product_photo, product_id").eq("id", uuidSchema.parse(input.backgroundAssetId)).single();
      if (!data) throw new UserFacingError("Fant ikke bakgrunnsbildet.");
      background = await downloadMedia(data.storage_path);
      bgAsset = data;
    }
    const out = await textGraphic({ format: f, headline, subline, theme, background });
    await saveAsset({ data: out, mime: "image/jpeg", folder: "graphics", kind: "text_graphic", is_ai_generated: bgAsset?.is_ai_generated ?? false, contains_real_product_photo: bgAsset?.contains_real_product_photo ?? false, prompt: null, provider: null, format: f, product_id: bgAsset?.product_id ?? null, source_asset_id: input.backgroundAssetId ?? null, source_product_image_id: null });
    await audit("media.text_graphic_created", { actorId: owner.id });
    return done("Tekstgrafikken er laget.");
  } catch (err) {
    return toActionError(err, "createTextGraphic");
  }
}

export async function reformatAsset(assetId: string, fmt: string): Promise<ActionResult> {
  try {
    await requireOwner();
    const f = format.parse(fmt);
    const supabase = await createClient();
    const { data: a } = await supabase.from("media_assets").select("*").eq("id", uuidSchema.parse(assetId)).single();
    if (!a) throw new UserFacingError("Fant ikke bildet.");
    if (a.media_type === "video") throw new UserFacingError("Videoer kan ikke beskjæres her.");
    const out = await toFormat(await downloadMedia(a.storage_path), f);
    await saveAsset({ data: out, mime: "image/jpeg", folder: "composites", kind: a.kind, is_ai_generated: a.is_ai_generated, contains_real_product_photo: a.contains_real_product_photo, prompt: a.prompt, provider: a.provider, format: f, product_id: a.product_id, source_asset_id: a.id, source_product_image_id: a.source_product_image_id });
    return done("Ny versjon i valgt format er lagret.");
  } catch (err) {
    return toActionError(err, "reformatAsset");
  }
}

/** Regenerer et AI-bilde med nye instruksjoner. */
export async function regenerateAsset(assetId: string, instructions: string): Promise<ActionResult> {
  try {
    await requireOwner();
    const supabase = await createClient();
    const { data: a } = await supabase.from("media_assets").select("*").eq("id", uuidSchema.parse(assetId)).single();
    if (!a) throw new UserFacingError("Fant ikke bildet.");
    if (!a.is_ai_generated || !a.prompt) throw new UserFacingError("Kun AI-genererte bilder kan regenereres.");
    const extra = z.string().trim().max(800).parse(instructions);
    if (a.kind === "composite" && a.source_product_image_id) {
      return createSceneImage({ productImageId: a.source_product_image_id, background: "ai", scene: `${a.prompt} ${extra}`.slice(0, 1000), format: a.format ?? "square", scale: 0.62, position: "center" });
    }
    return generateImage({ prompt: `${a.prompt} ${extra}`.slice(0, 1500), format: a.format && a.format !== "original" ? a.format : "square", sourceAssetId: a.id });
  } catch (err) {
    return toActionError(err, "regenerateAsset");
  }
}

export async function deleteAsset(assetId: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const supabase = await createClient();
    const { data: a } = await supabase.from("media_assets").select("*").eq("id", uuidSchema.parse(assetId)).single();
    if (!a) throw new UserFacingError("Fant ikke bildet.");
    const { count } = await supabase.from("posts").select("id", { count: "exact", head: true }).eq("image_path", a.storage_path).in("status", ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"]);
    if (count) throw new UserFacingError("Bildet brukes i et godkjent, planlagt eller publisert innlegg og kan ikke slettes.");
    const { error } = await supabase.from("media_assets").delete().eq("id", a.id);
    if (error) throw error;
    await removeMedia([a.storage_path, ...(a.thumbnail_path ? [a.thumbnail_path] : [])]);
    await audit("media.deleted", { actorId: owner.id, entity: "media", entityId: a.id });
    return done("Bildet er slettet.");
  } catch (err) {
    return toActionError(err, "deleteAsset");
  }
}
