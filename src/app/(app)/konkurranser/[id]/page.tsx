import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatShortDateTime } from "@/lib/dates";
import { Badge, Card, Notice } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { CONTEST_STATUS, hasEnded } from "@/lib/contests/status";
import { DrawPanel, ContestActions } from "./contest-panels";
import type { PostStatus } from "@/lib/posts/status";

export const metadata: Metadata = { title: "Konkurranse" };

const ROLE: Record<string, string> = { kunngjoring: "Kunngjøring", paminnelse: "Påminnelse", vinner: "Vinnerkunngjøring" };

export default async function ContestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwnerPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: c }, { data: posts }] = await Promise.all([
    supabase.from("contests").select("*").eq("id", id).maybeSingle(),
    supabase.from("posts").select("id, title, status, scheduled_at, contest_role, verification_notes, facebook_post_url").eq("contest_id", id).order("scheduled_at"),
  ]);
  if (!c) notFound();
  const ended = hasEnded(c.ends_at);
  return (
    <div>
      <Link href="/konkurranser" className="text-sm text-ink-soft hover:text-ink">
        ← Alle konkurranser
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">{c.title}</h1>
        <Badge className={CONTEST_STATUS[c.status]?.tone ?? ""}>{CONTEST_STATUS[c.status]?.label ?? c.status}</Badge>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <h2 className="text-lg">Innlegg</h2>
            <p className="mt-1 text-sm text-ink-soft">Gå gjennom, godkjenn og planlegg hvert innlegg. Ingenting publiseres uten godkjenning.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {(posts ?? []).map((p) => (
                <li key={p.id}>
                  <Link href={`/innlegg/${p.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-wood-50 px-3 py-2.5 hover:bg-wood-100">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{ROLE[p.contest_role ?? ""] ?? "Innlegg"}</span>
                      <span className="block text-xs capitalize text-ink-mute">{p.scheduled_at ? formatShortDateTime(p.scheduled_at) : "Ingen dato"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {p.verification_notes?.length > 0 && p.status !== "PUBLISHED" && <span className="text-xs text-amber-700">{p.verification_notes.length} merknad(er)</span>}
                      <StatusBadge status={p.status as PostStatus} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <DrawPanel id={c.id} ended={ended} status={c.status} winners={c.winners ?? []} entries={c.entries_count} drawnAt={c.drawn_at} listHash={c.draw_seed_hash} />
        </div>
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <h2 className="text-lg">Vilkår</h2>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-wood-50 p-3 text-xs leading-relaxed">{c.rules_text}</pre>
            <p className="mt-2 text-xs text-ink-mute">
              Periode: <span className="capitalize">{formatShortDateTime(c.starts_at)}</span> – <span className="capitalize">{formatShortDateTime(c.ends_at)}</span>. Kunngjøring: <span className="capitalize">{formatShortDateTime(c.announce_at)}</span>.
            </p>
          </Card>
          <Notice tone="info" title="Husk">
            <ul className="ml-4 list-disc">
              <li>Svar gjerne på kommentarene underveis – det gir mer rekkevidde.</li>
              <li>Kontakt vinneren via Facebook og få bekreftet at navnet kan publiseres.</li>
              <li>Slett deltakerlisten fra din egen maskin etter trekningen. Appen lagrer kun vinnerens navn og antall deltakere.</li>
            </ul>
          </Notice>
          <ContestActions id={c.id} status={c.status} />
        </div>
      </div>
    </div>
  );
}
