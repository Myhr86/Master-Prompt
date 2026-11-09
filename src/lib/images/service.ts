import "server-only";
import sharp from "sharp";
import { createClient } from "../supabase/server";
import { getSettings } from "../data";
import { getImageProvider } from "./providers";
import { backgroundPrompt, compositeProduct, textGraphic, toFormat } from "./compose";
import { downloadMedia, uploadMedia } from "./storage";
import { IMAGE_FORMATS, type ImageFormat } from "./formats";
import { UserFacingError } from "../action-result";
import type { MediaAsset, Post } from "../types";

type NewAsset = Omit<MediaAsset, "id" | "created_at" | "storage_path" | "width" | "height"> & { data: Buffer; mime: string; folder: Parameters<typeof uploadMedia>[2] };

export async function saveAsset(a: NewAsset): Promise<MediaAsset> {
  const meta = await sharp(a.data).metadata();
  const path = await uploadMedia(a.data, a.mime, a.folder);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      storage_path: path,
      kind: a.kind,
      is_ai_generated: a.is_ai_generated,
      contains_real_product_photo: a.contains_real_product_photo,
      prompt: a.prompt,
      provider: a.provider,
      width: meta.width ?? null,
      height: meta.height ?? null,
      format: a.format,
      product_id: a.product_id,
      source_asset_id: a.source_asset_id,
      source_product_image_id: a.source_product_image_id,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as MediaAsset;
}

/** Rolig, nøytral studiobakgrunn uten AI (brukes når ingen bildegenerator er satt opp). */
export async function plainBackground(format: ImageFormat): Promise<Buffer> {
  const { width, height } = IMAGE_FORMATS[format];
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0%" stop-color="#FFFDF9"/><stop offset="100%" stop-color="#EFE4D4"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect y="${Math.round(height * 0.72)}" width="100%" height="${Math.round(height * 0.28)}" fill="#E0CBAE" opacity="0.45"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

export async function generateAiImage(prompt: string, format: ImageFormat) {
  const settings = await getSettings();
  const provider = getImageProvider(settings.image_provider);
  if (!provider || !provider.isConfigured()) {
    throw new UserFacingError("Ingen bildegenerator er konfigurert. Legg inn OPENAI_API_KEY og velg leverandør i innstillingene – eller bruk egne bilder og tekstgrafikk.");
  }
  try {
    const res = await provider.generate({ prompt, format });
    return { data: await toFormat(res.data, format), provider: `${res.provider}:${res.model}` };
  } catch (err) {
    throw new UserFacingError(`Bildegenerering feilet: ${(err as Error).message}`);
  }
}

export async function primaryProductImage(productId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_images")
    .select("id, storage_path, image_type, is_primary")
    .eq("product_id", productId)
    .in("image_type", ["cutout", "product_photo"])
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Lager et nytt bilde til et innlegg.
 * - Har innlegget et produkt med ekte bilde: AI lager KUN miljøet, og det ekte
 *   produktbildet legges uendret oppå (komposisjon).
 * - Ellers: et rent AI-generert stemningsbilde, tydelig merket som AI.
 */
export async function createImageForPost(post: Post, instructions: string, _ownerId: string, format: ImageFormat = "square"): Promise<MediaAsset> {
  const scene = [instructions.trim(), post.image_suggestion ?? ""].filter(Boolean).join(". ") || "lyst skandinavisk interiør med naturlige materialer";
  const photo = post.product_id ? await primaryProductImage(post.product_id) : null;

  if (photo) {
    const settings = await getSettings();
    const provider = getImageProvider(settings.image_provider);
    let bg: Buffer;
    let usedProvider: string | null = null;
    const prompt = backgroundPrompt(scene, format);
    if (provider?.isConfigured()) {
      const gen = await generateAiImage(prompt, format);
      bg = gen.data;
      usedProvider = gen.provider;
    } else {
      bg = await plainBackground(format);
    }
    const productBuf = await downloadMedia(photo.storage_path);
    const out = await compositeProduct(bg, productBuf, { format, scale: 0.62, position: "center" });
    return saveAsset({
      data: out,
      mime: "image/jpeg",
      folder: "composites",
      kind: "composite",
      is_ai_generated: Boolean(usedProvider),
      contains_real_product_photo: true,
      prompt: usedProvider ? prompt : null,
      provider: usedProvider,
      format,
      product_id: post.product_id,
      source_asset_id: null,
      source_product_image_id: photo.id,
    });
  }

  const prompt = `${scene}. Fotorealistisk stemningsbilde i skandinavisk stil, varme naturfarger og tretoner. Ingen tekst, ingen logoer, ingen gjenkjennelige personer, og ikke vis noe spesifikt kundeprodukt.`;
  const gen = await generateAiImage(prompt, format);
  return saveAsset({
    data: gen.data,
    mime: "image/jpeg",
    folder: "generated",
    kind: "ai_generated",
    is_ai_generated: true,
    contains_real_product_photo: false,
    prompt,
    provider: gen.provider,
    format,
    product_id: post.product_id,
    source_asset_id: null,
    source_product_image_id: null,
  });
}

export { textGraphic, compositeProduct, toFormat, backgroundPrompt };
