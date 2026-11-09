import Link from "next/link";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/images/storage";
import { POST_STATUSES, STATUS_LABEL, type PostStatus } from "@/lib/posts/status";
import { formatShortDateTime } from "@/lib/dates";
import { ButtonLink, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/icons";
import { NewPostButton } from "./new-post-button";
import type { Post } from "@/lib/types";
import { POST_TYPE_LABEL } from "@/lib/ai/schemas";

export const metadata: Metadata = { title: "Innlegg" };

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireOwnerPage();
  const { status } = await searchParams;
  const filter = POST_STATUSES.includes(status as PostStatus) ? (status as PostStatus) : null;
  const supabase = await createClient();
  let q = supabase
    .from("posts")
    .select("id, title, content, status, scheduled_at, published_at, image_path, post_type, verification_notes, generated_by, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter === "APPROVED") q = q.in("status", ["APPROVED", "SCHEDULED"]);
  else if (filter) q = q.eq("status", filter);
  const { data } = await q;
  const posts = (data ?? []) as Post[];
  const urls = await signedUrls(posts.map((p) => p.image_path));

  const tabs: (PostStatus | null)[] = [null, "PENDING_APPROVAL", "DRAFT", "APPROVED", "PUBLISHED", "REJECTED", "FAILED"];

  return (
    <div>
      <PageHeader
        eyebrow="Innhold"
        title="Innlegg"
        subtitle="Gå gjennom forslagene, rediger, godkjenn og publiser."
        actions={
          <>
            <NewPostButton />
            <ButtonLink href="/generer">
              <Icon.sparkles /> Generer med AI
            </ButtonLink>
          </>
        }
      />
      <nav className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filtrer etter status">
        {tabs.map((t) => (
          <Link
            key={t ?? "all"}
            href={t ? `/innlegg?status=${t}` : "/innlegg"}
            className={cx(
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm ring-1 ring-inset",
              filter === t ? "bg-wood-700 text-white ring-wood-700" : "bg-paper text-ink-soft ring-line hover:bg-wood-50",
            )}
          >
            {t === null ? "Alle" : t === "APPROVED" ? "Godkjent og planlagt" : STATUS_LABEL[t]}
          </Link>
        ))}
      </nav>

      {posts.length === 0 ? (
        <EmptyState title="Ingen innlegg her ennå" action={<ButtonLink href="/generer">Generer ukens innlegg</ButtonLink>}>
          Claude kan lage forslag basert på produktbiblioteket. Alle forslag venter på din godkjenning.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/innlegg/${p.id}`} className="block h-full">
                <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-lift">
                  {p.image_path && urls[p.image_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[p.image_path]} alt="" className="aspect-[16/9] w-full object-cover" />
                  ) : (
                    <div className="grain aspect-[16/9] w-full bg-wood-50" />
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={p.status} />
                      {p.post_type && <span className="text-xs text-ink-mute">{POST_TYPE_LABEL[p.post_type as keyof typeof POST_TYPE_LABEL] ?? p.post_type}</span>}
                    </div>
                    <p className="line-clamp-2 font-medium text-ink">{p.title || "Uten tittel"}</p>
                    <p className="line-clamp-3 text-sm text-ink-soft">{p.content}</p>
                    <div className="mt-auto flex items-center justify-between pt-2 text-xs text-ink-mute">
                      <span className="capitalize">{p.published_at ? `Publisert ${formatShortDateTime(p.published_at)}` : p.scheduled_at ? formatShortDateTime(p.scheduled_at) : "Ingen dato"}</span>
                      {p.verification_notes?.length > 0 && <span className="text-amber-700">{p.verification_notes.length} merknad(er)</span>}
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
