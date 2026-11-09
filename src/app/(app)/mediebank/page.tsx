import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProducts } from "@/lib/data";
import { signedUrls } from "@/lib/images/storage";
import { integrations } from "@/lib/env";
import { Notice, PageHeader } from "@/components/ui";
import { MediaLibrary } from "./media-library";
import { MEDIA_CATEGORIES, MEDIA_CATEGORY_LABEL } from "@/lib/media/analyze";
import type { MediaAsset } from "@/lib/types";

export const metadata: Metadata = { title: "Mediebank" };
export const maxDuration = 300;

export default async function MediaLibraryPage() {
  await requireOwnerPage();
  const supabase = await createClient();
  const [{ data, error }, products] = await Promise.all([
    supabase.from("media_assets").select("*").eq("in_library", true).order("created_at", { ascending: false }).limit(500),
    getProducts(),
  ]);
  const assets = (data ?? []) as MediaAsset[];
  const urls = await signedUrls(assets.map((a) => a.storage_path));
  return (
    <div>
      <PageHeader
        eyebrow="Eget materiale"
        title="Mediebank"
        subtitle="Last opp bilder fra verkstedet, graveringen, produksjonen og produktene i hyllene. Claude beskriver hvert bilde én gang og kan deretter velge passende bilder når innlegg lages."
      />
      {error && (
        <div className="mb-5">
          <Notice tone="warn" title="Databasen mangler en oppdatering">
            Kjør <code>supabase/migrations/20261109000005_media_library.sql</code> i Supabase → SQL Editor for å ta i bruk mediebanken.
          </Notice>
        </div>
      )}
      {!integrations().anthropic && (
        <div className="mb-5">
          <Notice tone="info">Claude er ikke konfigurert, så bildene blir ikke beskrevet automatisk. Du kan skrive beskrivelser selv.</Notice>
        </div>
      )}
      <MediaLibrary
        aiReady={integrations().anthropic}
        categories={MEDIA_CATEGORIES.map((c) => ({ id: c, label: MEDIA_CATEGORY_LABEL[c] }))}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        assets={assets.map((a) => ({
          id: a.id,
          url: urls[a.storage_path] ?? null,
          description: a.description,
          tags: a.tags ?? [],
          category: a.category,
          productId: a.product_id,
          peopleVisible: Boolean(a.people_visible),
          status: a.analysis_status,
          error: a.analysis_error,
          useCount: a.use_count ?? 0,
          lastUsedAt: a.last_used_at,
          createdAt: a.created_at,
        }))}
      />
    </div>
  );
}
