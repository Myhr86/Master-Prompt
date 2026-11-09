"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Post } from "@/lib/types";
import type { ActionResult } from "@/lib/action-result";
import { Button, Card, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  applyVariant,
  approvePost,
  deletePost,
  publishNow,
  regenerateImage,
  regenerateText,
  rejectPost,
  revokeApproval,
  schedulePostLocal,
  setDesiredTimeLocal,
  setPostImage,
  submitForApproval,
  unschedulePost,
  updatePost,
} from "../actions";

interface Props {
  post: Post;
  approvalValid: boolean;
  publishMode: "live" | "simulated";
  metaConfigured: boolean;
  fbConnected: boolean;
  aiConfigured: boolean;
  products: { id: string; name: string }[];
  productImages: { id: string; url: string | null; productId: string; label: string }[];
  assets: { id: string; url: string | null; ai: boolean; kind: string }[];
  startEditing: boolean;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

type Panel = null | "edit" | "text" | "image";

export function PostWorkspace(props: Props) {
  const { post } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [panel, setPanel] = useState<Panel>(props.startEditing ? "edit" : null);
  const [when, setWhen] = useState(toLocalInput(post.scheduled_at));
  const [textInstr, setTextInstr] = useState("");
  const [imgInstr, setImgInstr] = useState("");

  const locked = post.status === "PUBLISHED" || post.status === "PUBLISHING";
  const approved = ["APPROVED", "SCHEDULED", "FAILED"].includes(post.status) && props.approvalValid;
  const canApprove = ["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(post.status);

  const run = (fn: () => Promise<ActionResult<unknown>>, opts: { confirm?: string; after?: () => void } = {}) => {
    if (opts.confirm && !window.confirm(opts.confirm)) return;
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        opts.after?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {result && (
        <Notice tone={result.ok ? "success" : "error"}>
          {result.ok ? result.message : result.error}
          {result.ok && (result.data as { url?: string } | undefined)?.url && (
            <>
              {" "}
              <a className="underline" href={(result.data as { url: string }).url} target="_blank" rel="noopener noreferrer">
                Se innlegget på Facebook
              </a>
            </>
          )}
        </Notice>
      )}

      {!locked && (
        <Card className="p-5">
          {canApprove && (
            <>
              <h2 className="text-lg">Godkjenning</h2>
              <p className="mt-1 text-sm text-ink-soft">Les gjennom forhåndsvisningen. Ingenting publiseres før du har godkjent – og publisering er et eget steg etterpå.</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button variant="success" disabled={pending || !post.content.trim()} onClick={() => run(() => approvePost(post.id))} className="col-span-2 sm:col-auto">
                  <Icon.check /> Godkjenn
                </Button>
                <Button variant="secondary" disabled={pending} onClick={() => setPanel(panel === "edit" ? null : "edit")}>Rediger</Button>
                <Button variant="secondary" disabled={pending} onClick={() => setPanel(panel === "image" ? null : "image")}>Generer nytt bilde</Button>
                <Button variant="secondary" disabled={pending} onClick={() => setPanel(panel === "text" ? null : "text")}>Generer ny tekst</Button>
                {post.status !== "REJECTED" && (
                  <Button variant="secondary" disabled={pending} onClick={() => run(() => rejectPost(post.id))}>
                    <Icon.x /> Avvis
                  </Button>
                )}
                {post.status === "DRAFT" && (
                  <Button variant="ghost" disabled={pending || !post.content.trim()} onClick={() => run(() => submitForApproval(post.id))}>
                    Send til godkjenning
                  </Button>
                )}
                <Button variant="danger" disabled={pending} onClick={() => run(() => deletePost(post.id), { confirm: "Slette dette utkastet for godt?", after: () => router.push("/innlegg") })}>
                  Slett utkast
                </Button>
              </div>
            </>
          )}

          {approved && (
            <>
              <h2 className="text-lg">Publisering</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Innlegget er godkjent. {props.publishMode === "simulated" ? "Testmodus er på – publisering blir simulert, ingenting sendes til Facebook." : "Publisering sendes til Facebook-siden."}
              </p>
              {props.publishMode === "live" && !props.fbConnected && (
                <div className="mt-3">
                  <Notice tone="warn">
                    Facebook-siden er ikke tilkoblet. <Link href="/innstillinger#facebook" className="underline">Koble til</Link>
                  </Notice>
                </div>
              )}
              <div className="mt-4 flex flex-col gap-3">
                <Button
                  disabled={pending}
                  onClick={() => run(() => publishNow(post.id), { confirm: props.publishMode === "live" ? "Publisere innlegget på Facebook nå?" : "Kjøre en simulert publisering (testmodus)?" })}
                >
                  {props.publishMode === "live" ? "Publiser nå" : "Publiser nå (simulert)"}
                </Button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field label="Planlegg publisering (norsk tid)" htmlFor="when">
                    <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                  </Field>
                  <Button variant="secondary" disabled={pending || !when} onClick={() => run(() => schedulePostLocal(post.id, when))}>
                    {post.status === "SCHEDULED" ? "Endre tidspunkt" : "Planlegg"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {post.status === "SCHEDULED" && (
                    <Button variant="ghost" disabled={pending} onClick={() => run(() => unschedulePost(post.id))}>
                      Fjern planlegging
                    </Button>
                  )}
                  <Button variant="ghost" disabled={pending} onClick={() => run(() => revokeApproval(post.id))}>
                    Trekk tilbake godkjenning
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => setPanel(panel === "edit" ? null : "edit")}>
                    Rediger
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => run(() => rejectPost(post.id))}>
                    Avvis
                  </Button>
                  <Button variant="danger" disabled={pending} onClick={() => run(() => deletePost(post.id), { confirm: "Slette innlegget for godt?", after: () => router.push("/innlegg") })}>
                    Slett
                  </Button>
                </div>
              </div>
            </>
          )}

          {canApprove && (
            <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-end">
              <Field label="Ønsket publiseringstidspunkt (norsk tid)" htmlFor="desired" hint="Brukes når du planlegger etter godkjenning.">
                <Input id="desired" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <Button variant="secondary" disabled={pending || !when} onClick={() => run(() => setDesiredTimeLocal(post.id, when))}>
                Lagre tidspunkt
              </Button>
            </div>
          )}
        </Card>
      )}

      {panel === "edit" && !locked && <EditForm post={post} products={props.products} onDone={() => router.refresh()} />}

      {panel === "text" && !locked && (
        <Card className="p-5">
          <h2 className="text-lg">Generer ny tekst</h2>
          {!props.aiConfigured && <div className="mt-2"><Notice tone="warn">Claude er ikke konfigurert på serveren.</Notice></div>}
          <Field label="Hva vil du endre? (valgfritt)" htmlFor="ti">
            <Textarea id="ti" rows={3} maxLength={1500} value={textInstr} onChange={(e) => setTextInstr(e.target.value)} placeholder="F.eks. kortere, mer fokus på minner, nevn at flisen er 20 × 20 cm …" />
          </Field>
          <Button className="mt-3" disabled={pending || !props.aiConfigured} onClick={() => run(() => regenerateText(post.id, textInstr), { after: () => setPanel(null) })}>
            {pending ? "Claude skriver …" : "Lag ny tekst"}
          </Button>
          {post.approved_at && <p className="mt-2 text-xs text-ink-mute">Ny tekst opphever godkjenningen.</p>}
        </Card>
      )}

      {panel === "image" && !locked && (
        <ImagePanel {...props} pending={pending} imgInstr={imgInstr} setImgInstr={setImgInstr} run={run} />
      )}

      {post.variants?.length > 0 && !locked && (
        <Card className="p-5">
          <h2 className="text-lg">Alternative tekster</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {post.variants.map((v, i) => (
              <li key={i} className="rounded-2xl bg-wood-50 p-4">
                <p className="font-medium">{v.title}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{v.content}</p>
                <Button variant="secondary" className="mt-3" disabled={pending} onClick={() => run(() => applyVariant(post.id, i))}>
                  Bruk denne
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!locked && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setPanel(panel === "image" ? null : "image")}>
            <Icon.image /> Velg bilde
          </Button>
        </div>
      )}
    </div>
  );
}

function ImagePanel({
  post,
  productImages,
  assets,
  pending,
  imgInstr,
  setImgInstr,
  run,
}: Props & { pending: boolean; imgInstr: string; setImgInstr: (s: string) => void; run: (fn: () => Promise<ActionResult<unknown>>) => void }) {
  const relevant = post.product_id ? productImages.filter((i) => i.productId === post.product_id) : productImages;
  return (
    <Card className="p-5">
      <h2 className="text-lg">Bilde</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {post.product_id
          ? "Nytt bilde lages som komposisjon: AI lager kun miljøet, og det ekte produktbildet legges uendret oppå."
          : "Uten produkt lages et AI-generert stemningsbilde, merket som AI. Knytt et produkt til innlegget for å bruke ekte produktbilder."}
      </p>
      <Field label="Instruksjoner til bildet (valgfritt)" htmlFor="ii">
        <Textarea id="ii" rows={2} maxLength={1000} value={imgInstr} onChange={(e) => setImgInstr(e.target.value)} placeholder="F.eks. lys stue med eikebord, julestemning, morgenlys …" />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => run(() => regenerateImage(post.id, imgInstr))}>
          {pending ? "Lager bilde …" : "Generer nytt bilde"}
        </Button>
        {post.image_path && (
          <Button variant="ghost" disabled={pending} onClick={() => run(() => setPostImage(post.id, { kind: "none" }))}>
            Fjern bilde
          </Button>
        )}
        <Link href={`/bilder?innlegg=${post.id}`} className="inline-flex min-h-11 items-center px-3 text-sm text-wood-700 underline">
          Åpne bildeverkstedet
        </Link>
      </div>

      {relevant.length > 0 && (
        <>
          <p className="mt-5 text-sm font-medium">Ekte produktbilder</p>
          <ImageGrid items={relevant.map((i) => ({ id: i.id, url: i.url, label: i.label }))} onPick={(id) => run(() => setPostImage(post.id, { kind: "product_image", id }))} disabled={pending} />
        </>
      )}
      {assets.length > 0 && (
        <>
          <p className="mt-5 text-sm font-medium">Fra bildeverkstedet</p>
          <ImageGrid items={assets.map((a) => ({ id: a.id, url: a.url, label: a.ai ? "AI" : "" }))} onPick={(id) => run(() => setPostImage(post.id, { kind: "asset", id }))} disabled={pending} />
        </>
      )}
    </Card>
  );
}

function ImageGrid({ items, onPick, disabled }: { items: { id: string; url: string | null; label: string }[]; onPick: (id: string) => void; disabled: boolean }) {
  return (
    <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <li key={i.id}>
          <button disabled={disabled} onClick={() => onPick(i.id)} className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-wood-50 ring-1 ring-line hover:ring-wood-400">
            {i.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.url} alt={i.label} className="size-full object-cover" />
            )}
            {i.label && <span className="absolute bottom-1 left-1 max-w-[90%] truncate rounded bg-black/55 px-1.5 text-[10px] text-white">{i.label}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EditForm({ post, products, onDone }: { post: Post; products: { id: string; name: string }[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: ActionResult | undefined, fd: FormData) => {
    const r = await updatePost(prev, fd);
    if (r.ok) onDone();
    return r;
  }, undefined);
  return (
    <Card className="p-5">
      <h2 className="text-lg">Rediger innlegg</h2>
      {post.approved_at && <p className="mt-1 text-sm text-amber-800">Merk: endringer i tekst, emneknagger, lenke eller bilde opphever godkjenningen.</p>}
      <form action={action} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="id" value={post.id} />
        {state && <Notice tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Notice>}
        <Field label="Overskrift / innledning" htmlFor="title">
          <Input id="title" name="title" defaultValue={post.title} maxLength={300} />
        </Field>
        <Field label="Tekst" htmlFor="content">
          <Textarea id="content" name="content" defaultValue={post.content} rows={9} maxLength={10000} required />
        </Field>
        <Field label="Emneknagger" htmlFor="hashtags" hint="Skill med mellomrom, f.eks. #personligegaver #norskhåndverk">
          <Input id="hashtags" name="hashtags" defaultValue={post.hashtags.join(" ")} />
        </Field>
        <Field label="Lenke" htmlFor="link_url">
          <Input id="link_url" name="link_url" type="url" defaultValue={post.link_url ?? ""} placeholder="https://myhrtreogdesign.com/…" />
        </Field>
        <Field label="Produkt" htmlFor="product_id">
          <Select id="product_id" name="product_id" defaultValue={post.product_id ?? ""}>
            <option value="">Ingen produkt</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className={cx("flex gap-2")}>
          <Button type="submit" disabled={pending}>
            {pending ? "Lagrer …" : "Lagre endringer"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
