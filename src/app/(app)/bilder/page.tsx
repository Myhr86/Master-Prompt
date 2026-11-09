import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProducts, getSettings } from "@/lib/data";
import { signedUrls } from "@/lib/images/storage";
import { getImageProvider } from "@/lib/images/providers";
import { IMAGE_FORMATS } from "@/lib/images/formats";
import { Notice, PageHeader } from "@/components/ui";
import { Studio } from "./studio";
import type { MediaAsset, ProductImage } from "@/lib/types";

export const metadata: Metadata = { title: "Bildeverksted" };
export const maxDuration = 300;

export default async function ImagesPage({ searchParams }: { searchParams: Promise<{ innlegg?: string }> }) {
  await requireOwnerPage();
  const { innlegg } = await searchParams;
  const postId = innlegg && /^[0-9a-f-]{36}$/i.test(innlegg) ? innlegg : null;
  const supabase = await createClient();
  const [settings, products, imagesRes, assetsRes, postRes] = await Promise.all([
    getSettings(),
    getProducts(),
    supabase.from("product_images").select("*").order("is_primary", { ascending: false }),
    supabase.from("media_assets").select("*").order("created_at", { ascending: false }).limit(60),
    postId ? supabase.from("posts").select("id, title, status").eq("id", postId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const productImages = (imagesRes.data ?? []) as ProductImage[];
  // Videoer håndteres i Mediebanken, ikke i bildeverkstedet.
  const assets = ((assetsRes.data ?? []) as MediaAsset[]).filter((a) => a.media_type !== "video");
  const urls = await signedUrls([...productImages.map((i) => i.storage_path), ...assets.map((a) => a.storage_path)]);
  const provider = getImageProvider(settings.image_provider);
  const aiReady = Boolean(provider?.isConfigured());

  return (
    <div>
      <PageHeader
        eyebrow="AI Image Studio"
        title="Bildeverksted"
        subtitle="Lag miljøbilder med ekte produktfoto, tekstgrafikk og Facebook-vennlige formater. AI endrer aldri selve produktet."
      />
      {postRes.data && (
        <div className="mb-5">
          <Notice tone="info">
            Du velger bilde til innlegget «{postRes.data.title || "Uten tittel"}». Trykk «Bruk i innlegget» på et bilde.{" "}
            <Link href={`/innlegg/${postRes.data.id}`} className="underline">
              Tilbake til innlegget
            </Link>
          </Notice>
        </div>
      )}
      {!aiReady && (
        <div className="mb-5">
          <Notice tone="info" title="Bildegenerator ikke aktiv">
            {settings.image_provider === "none" ? "Bildegenerering er slått av i innstillingene." : "OPENAI_API_KEY mangler på serveren."} Du kan fortsatt laste opp bilder, lage miljøbilder på nøytral bakgrunn og tekstgrafikk.
          </Notice>
        </div>
      )}
      <Studio
        aiReady={aiReady}
        postId={postRes.data && !["PUBLISHED", "PUBLISHING"].includes(postRes.data.status) ? postRes.data.id : null}
        formats={Object.entries(IMAGE_FORMATS).map(([k, v]) => ({ id: k, label: v.label }))}
        productImages={productImages.map((i) => ({ id: i.id, url: urls[i.storage_path] ?? null, label: products.find((p) => p.id === i.product_id)?.name ?? "" }))}
        assets={assets.map((a) => ({ id: a.id, url: urls[a.storage_path] ?? null, kind: a.kind, ai: a.is_ai_generated, realProduct: a.contains_real_product_photo, format: a.format, prompt: a.prompt, createdAt: a.created_at }))}
      />
    </div>
  );
}
