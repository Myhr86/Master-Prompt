import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFacebookStatus, getPost, getProducts, getSettings } from "@/lib/data";
import { signedUrls } from "@/lib/images/storage";
import { formatShortDateTime } from "@/lib/dates";
import { postContentHash } from "@/lib/posts/content-hash";
import { effectivePublishMode } from "@/lib/posts/mode";
import { integrations } from "@/lib/env";
import { Card, Notice } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { FacebookPreview } from "@/components/facebook-preview";
import { POST_TYPE_LABEL } from "@/lib/ai/schemas";
import { readUtm } from "@/lib/posts/utm";
import { PostWorkspace } from "./post-workspace";
import type { MediaAsset, ProductImage } from "@/lib/types";

export const metadata: Metadata = { title: "Innlegg" };


export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rediger?: string }> }) {
  await requireOwnerPage();
  const { id } = await params;
  const { rediger } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const post = await getPost(id);
  if (!post) notFound();

  const supabase = await createClient();
  const [settings, fb, products, productImagesRes, assetsRes, historyRes, attemptsRes] = await Promise.all([
    getSettings(),
    getFacebookStatus(),
    getProducts(),
    supabase.from("product_images").select("*").order("is_primary", { ascending: false }).limit(200),
    supabase.from("media_assets").select("*").order("created_at", { ascending: false }).limit(40),
    supabase.from("post_history").select("id, changed_at, approval_revoked, previous_content").eq("post_id", id).order("changed_at", { ascending: false }).limit(10),
    supabase.from("publish_attempts").select("id, state, mode, started_at, finished_at, error").eq("post_id", id).order("started_at", { ascending: false }).limit(10),
  ]);
  const productImages = (productImagesRes.data ?? []) as ProductImage[];
  const assets = (assetsRes.data ?? []) as MediaAsset[];
  const urls = await signedUrls([post.image_path, ...productImages.map((i) => i.storage_path), ...assets.map((a) => a.storage_path)]);
  const currentAsset = assets.find((a) => a.id === post.image_asset_id);
  const approvalValid = Boolean(post.approved_at && post.approved_content_hash === postContentHash(post));
  const mode = effectivePublishMode(settings.test_mode);
  const quality = post.quality;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/innlegg" className="text-sm text-ink-soft hover:text-ink">
          ← Alle innlegg
        </Link>
        <StatusBadge status={post.status} />
        {post.generated_by === "ai" && <span className="text-xs text-ink-mute">Forslag fra AI{post.ai_model ? ` (${post.ai_model})` : ""}</span>}
        {post.post_type && <span className="text-xs text-ink-mute">· {POST_TYPE_LABEL[post.post_type as keyof typeof POST_TYPE_LABEL] ?? post.post_type}</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <FacebookPreview
            pageName={fb?.page_name ?? settings.business_name}
            title={post.title}
            content={post.content}
            hashtags={post.hashtags}
            linkUrl={post.link_url}
            imageUrl={post.image_path ? urls[post.image_path] ?? null : null}
            isAiImage={currentAsset?.is_ai_generated}
            when={post.scheduled_at ? formatShortDateTime(post.scheduled_at) : undefined}
          />
          {post.link_url && (
            <p className="text-xs text-ink-mute">
              Lenke:{" "}
              <a href={post.link_url} target="_blank" rel="noopener noreferrer" className="break-all text-wood-700 underline">
                {post.link_url}
              </a>
            </p>
          )}
          {readUtm(post.link_url) && (
            <p className="text-xs text-ink-mute">
              Sporingskode i Shopify: <span className="font-mono text-ink">{readUtm(post.link_url)!.content}</span> (kampanje «{readUtm(post.link_url)!.campaign}»)
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {post.status === "PUBLISHED" && (
            <Notice tone="success" title="Publisert på Facebook">
              {post.published_at && <span className="capitalize">{formatShortDateTime(post.published_at)}. </span>}
              {post.facebook_post_url && (
                <a href={post.facebook_post_url} target="_blank" rel="noopener noreferrer" className="underline">
                  Åpne innlegget
                </a>
              )}
            </Notice>
          )}
          {post.status === "FAILED" && post.publish_error && <Notice tone="error" title="Publisering feilet">{post.publish_error}</Notice>}
          {post.status === "PUBLISHING" && <Notice tone="warn" title="Publisering pågår / uavklart">Systemet kontrollerer Facebook før et eventuelt nytt forsøk. Ikke publiser manuelt i mellomtiden.</Notice>}
          {post.verification_notes.length > 0 && post.status !== "PUBLISHED" && (
            <Notice tone="warn" title="Må kontrolleres før godkjenning">
              <ul className="ml-4 list-disc">
                {post.verification_notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </Notice>
          )}

          <PostWorkspace
            post={post}
            approvalValid={approvalValid}
            publishMode={mode}
            metaConfigured={integrations().meta}
            fbConnected={fb?.connection_status === "connected"}
            aiConfigured={integrations().anthropic}
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            productImages={productImages.map((i) => ({ id: i.id, url: urls[i.storage_path] ?? null, productId: i.product_id, label: products.find((p) => p.id === i.product_id)?.name ?? "" }))}
            assets={assets.map((a) => ({ id: a.id, url: urls[a.storage_path] ?? null, ai: a.is_ai_generated, kind: a.kind }))}
            startEditing={rediger === "1"}
          />

          {(post.rationale || quality) && (
            <Card className="p-5">
              <h2 className="text-lg">Hvorfor dette innlegget</h2>
              {post.rationale && <p className="mt-2 text-sm text-ink-soft">{post.rationale}</p>}
              {post.image_suggestion && (
                <p className="mt-3 text-sm text-ink-soft">
                  <span className="font-medium text-ink">Bildeforslag:</span> {post.image_suggestion}
                </p>
              )}
              {quality && (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">Intern egenvurdering fra AI (ikke en garanti)</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                    {(
                      [
                        ["Relevans", quality.relevance],
                        ["Språk", quality.language],
                        ["Originalitet", quality.originality],
                        ["Produktkorrekthet", quality.product_accuracy],
                        ["Markedsføringsverdi", quality.marketing_value],
                        ["Visuell kvalitet", quality.visual_quality],
                      ] as const
                    ).map(([label, v]) => (
                      <div key={label} className="flex items-center justify-between gap-2">
                        <dt className="text-ink-soft">{label}</dt>
                        <dd className="font-medium tabular-nums">{v}/5</dd>
                      </div>
                    ))}
                  </dl>
                  {quality.notes && <p className="mt-2 text-xs text-ink-mute">{quality.notes}</p>}
                </div>
              )}
            </Card>
          )}

          {(historyRes.data?.length || attemptsRes.data?.length) ? (
            <Card className="p-5">
              <h2 className="text-lg">Historikk</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-soft">
                {(attemptsRes.data ?? []).map((a) => (
                  <li key={a.id}>
                    <span className="capitalize">{formatShortDateTime(a.started_at)}</span> – {a.mode === "simulated" ? "Simulert publisering" : "Publiseringsforsøk"}:{" "}
                    {{ succeeded: "vellykket", failed: "feilet", unknown: "uavklart", in_progress: "pågår" }[a.state as string]}
                    {a.error ? ` (${a.error})` : ""}
                  </li>
                ))}
                {(historyRes.data ?? []).map((h) => (
                  <li key={h.id}>
                    <span className="capitalize">{formatShortDateTime(h.changed_at)}</span> – Innholdet ble endret{h.approval_revoked ? " (godkjenning opphevet)" : ""}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
