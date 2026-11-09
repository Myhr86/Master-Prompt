"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { createSceneImage, createTextGraphic, deleteAsset, generateImage, reformatAsset, regenerateAsset, uploadAssets } from "./actions";
import { setPostImage } from "../innlegg/actions";

interface Asset {
  id: string;
  url: string | null;
  kind: string;
  ai: boolean;
  realProduct: boolean;
  format: string | null;
  prompt: string | null;
  createdAt: string;
}

type Tab = "scene" | "ai" | "text" | "upload";
const KIND: Record<string, string> = { upload: "Opplastet", ai_generated: "AI-generert", composite: "Miljøbilde", text_graphic: "Tekstgrafikk" };

export function Studio({
  aiReady,
  postId,
  formats,
  productImages,
  assets,
}: {
  aiReady: boolean;
  postId: string | null;
  formats: { id: string; label: string }[];
  productImages: { id: string; url: string | null; label: string }[];
  assets: Asset[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("scene");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  // Skjema-tilstand
  const [productImageId, setProductImageId] = useState(productImages[0]?.id ?? "");
  const [bg, setBg] = useState<"ai" | "plain" | "asset">(aiReady ? "ai" : "plain");
  const [bgAsset, setBgAsset] = useState("");
  const [scene, setScene] = useState("");
  const [fmt, setFmt] = useState("square");
  const [scale, setScale] = useState(0.6);
  const [position, setPosition] = useState("center");
  const [prompt, setPrompt] = useState("");
  const [headline, setHeadline] = useState("");
  const [subline, setSubline] = useState("");
  const [theme, setTheme] = useState("light");
  const [regenText, setRegenText] = useState("");

  const [uploadState, uploadAction, uploading] = useActionState(async (prev: ActionResult | undefined, fd: FormData) => {
    const r = await uploadAssets(prev, fd);
    if (r.ok) router.refresh();
    return r;
  }, undefined);

  const sel = assets.find((a) => a.id === selected) ?? null;
  const backgroundCandidates = assets.filter((a) => !a.realProduct && a.kind !== "text_graphic");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 overflow-x-auto rounded-full bg-wood-50 p-1 ring-1 ring-line" role="tablist">
          {(
            [
              ["scene", "Miljøbilde"],
              ["text", "Tekstgrafikk"],
              ["ai", "AI-bilde"],
              ["upload", "Last opp"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("min-h-10 flex-1 shrink-0 rounded-full px-3 text-sm", tab === k ? "bg-paper font-medium shadow-soft" : "text-ink-soft")}>
              {label}
            </button>
          ))}
        </div>
        {result && <Notice tone={result.ok ? "success" : "error"}>{result.ok ? result.message : result.error}</Notice>}

        {tab === "scene" && (
          <Card className="flex flex-col gap-4 p-5">
            <p className="text-sm text-ink-soft">Det ekte produktbildet legges uendret (kun proporsjonalt skalert) oppå bakgrunnen. Form, ramme og design bevares nøyaktig.</p>
            {productImages.length === 0 ? (
              <Notice tone="info">Last opp produktbilder i produktbiblioteket først.</Notice>
            ) : (
              <>
                <Field label="Produktbilde" htmlFor="pi">
                  <Select id="pi" value={productImageId} onChange={(e) => setProductImageId(e.target.value)}>
                    {productImages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bakgrunn" htmlFor="bg">
                  <Select id="bg" value={bg} onChange={(e) => setBg(e.target.value as typeof bg)}>
                    <option value="ai" disabled={!aiReady}>
                      Generer miljø med AI{!aiReady ? " (ikke konfigurert)" : ""}
                    </option>
                    <option value="plain">Nøytral studiobakgrunn (uten AI)</option>
                    <option value="asset" disabled={!backgroundCandidates.length}>
                      Velg fra biblioteket
                    </option>
                  </Select>
                </Field>
                {bg === "ai" && (
                  <Field label="Beskriv miljøet" htmlFor="scene">
                    <Textarea id="scene" rows={2} value={scene} maxLength={1000} onChange={(e) => setScene(e.target.value)} placeholder="Lys stue med eikebord og grønne planter, morgenlys" />
                  </Field>
                )}
                {bg === "asset" && (
                  <Field label="Bakgrunnsbilde" htmlFor="bga">
                    <Select id="bga" value={bgAsset} onChange={(e) => setBgAsset(e.target.value)}>
                      <option value="">Velg …</option>
                      {backgroundCandidates.map((a) => (
                        <option key={a.id} value={a.id}>
                          {KIND[a.kind]} – {new Date(a.createdAt).toLocaleDateString("nb-NO")}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormatSelect formats={formats} value={fmt} onChange={setFmt} />
                  <Field label={`Størrelse (${Math.round(scale * 100)} %)`} htmlFor="scale">
                    <input id="scale" type="range" min={0.3} max={0.85} step={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="accent-wood-700" />
                  </Field>
                  <Field label="Plassering" htmlFor="pos">
                    <Select id="pos" value={position} onChange={(e) => setPosition(e.target.value)}>
                      <option value="center">Midten</option>
                      <option value="bottom">Nederst</option>
                      <option value="left">Venstre</option>
                      <option value="right">Høyre</option>
                    </Select>
                  </Field>
                </div>
                <Button disabled={pending || !productImageId || (bg === "asset" && !bgAsset)} onClick={() => run(() => createSceneImage({ productImageId, background: bg, backgroundAssetId: bg === "asset" ? bgAsset : undefined, scene, format: fmt, scale, position }))}>
                  {pending ? "Lager bilde …" : "Lag miljøbilde"}
                </Button>
              </>
            )}
          </Card>
        )}

        {tab === "text" && (
          <Card className="flex flex-col gap-4 p-5">
            <p className="text-sm text-ink-soft">Teksten tegnes av systemet (ikke av AI), så den blir alltid riktig stavet.</p>
            <Field label="Overskrift" htmlFor="hl">
              <Input id="hl" value={headline} maxLength={120} onChange={(e) => setHeadline(e.target.value)} placeholder="Minner som varer" />
            </Field>
            <Field label="Undertekst (valgfritt)" htmlFor="sl">
              <Input id="sl" value={subline} maxLength={240} onChange={(e) => setSubline(e.target.value)} placeholder="Personlige fliser med deres egne bilder" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormatSelect formats={formats} value={fmt} onChange={setFmt} />
              <Field label="Stil" htmlFor="theme">
                <Select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="light">Lys</option>
                  <option value="wood">Tre</option>
                  <option value="dark">Mørk</option>
                </Select>
              </Field>
              <Field label="Bakgrunn" htmlFor="tbg">
                <Select id="tbg" value={bgAsset} onChange={(e) => setBgAsset(e.target.value)}>
                  <option value="">Ensfarget</option>
                  {assets.filter((a) => a.kind !== "text_graphic").map((a) => (
                    <option key={a.id} value={a.id}>
                      {KIND[a.kind]} – {new Date(a.createdAt).toLocaleDateString("nb-NO")}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button disabled={pending || !headline.trim()} onClick={() => run(() => createTextGraphic({ headline, subline, theme, format: fmt, backgroundAssetId: bgAsset || undefined }))}>
              {pending ? "Lager …" : "Lag tekstgrafikk"}
            </Button>
          </Card>
        )}

        {tab === "ai" && (
          <Card className="flex flex-col gap-4 p-5">
            <p className="text-sm text-ink-soft">Rene AI-bilder brukes til stemning og bakgrunner. De merkes som AI-genererte og skal ikke presenteres som bilder av ekte kundeprodukter.</p>
            <Field label="Beskriv bildet" htmlFor="prompt">
              <Textarea id="prompt" rows={3} value={prompt} maxLength={1500} onChange={(e) => setPrompt(e.target.value)} placeholder="Høstlig bord med kaffekopp og ullpledd, varmt lys" />
            </Field>
            <FormatSelect formats={formats} value={fmt} onChange={setFmt} />
            <Button disabled={pending || !aiReady || prompt.trim().length < 5} onClick={() => run(() => generateImage({ prompt, format: fmt }))}>
              {pending ? "Genererer …" : "Generer bilde"}
            </Button>
          </Card>
        )}

        {tab === "upload" && (
          <Card className="p-5">
            <form action={uploadAction} className="flex flex-col gap-4">
              {uploadState && <Notice tone={uploadState.ok ? "success" : "error"}>{uploadState.ok ? uploadState.message : uploadState.error}</Notice>}
              <Field label="Bilder" htmlFor="up" hint="JPEG, PNG eller WebP, maks 15 MB. Metadata fjernes automatisk. Produktbilder lastes opp under hvert produkt.">
                <input id="up" name="files" type="file" multiple accept="image/jpeg,image/png,image/webp" className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-wood-100 file:px-4 file:py-2" />
              </Field>
              <Button type="submit" disabled={uploading}>
                {uploading ? "Laster opp …" : "Last opp"}
              </Button>
            </form>
          </Card>
        )}

        {sel && (
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-lg">Valgt bilde</h2>
            <div className="flex flex-wrap gap-1.5">
              <Badge className="bg-wood-50 text-wood-800 ring-wood-200">{KIND[sel.kind]}</Badge>
              {sel.ai && <Badge className="bg-violet-50 text-violet-800 ring-violet-200">Inneholder AI-generert innhold</Badge>}
              {sel.realProduct && <Badge className="bg-moss-50 text-moss-700 ring-moss-100">Ekte produktfoto</Badge>}
            </div>
            {postId && (
              <Button variant="success" disabled={pending} onClick={() => run(() => setPostImage(postId, { kind: "asset", id: sel.id }), () => router.push(`/innlegg/${postId}`))}>
                Bruk i innlegget
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              {formats.map((f) => (
                <Button key={f.id} variant="secondary" disabled={pending} onClick={() => run(() => reformatAsset(sel.id, f.id))}>
                  {f.label.split(" (")[0]}
                </Button>
              ))}
            </div>
            {sel.ai && sel.prompt && (
              <div className="flex flex-col gap-2">
                <Field label="Regenerer med nye instruksjoner" htmlFor="rg">
                  <Input id="rg" value={regenText} maxLength={800} onChange={(e) => setRegenText(e.target.value)} placeholder="Varmere lys, mer luft rundt produktet …" />
                </Field>
                <Button variant="secondary" disabled={pending || !aiReady} onClick={() => run(() => regenerateAsset(sel.id, regenText))}>
                  Regenerer
                </Button>
              </div>
            )}
            <Button variant="danger" disabled={pending} onClick={() => confirm("Slette bildet?") && run(() => deleteAsset(sel.id), () => setSelected(null))}>
              Slett bilde
            </Button>
          </Card>
        )}
      </div>

      <section aria-label="Bildebibliotek">
        <h2 className="mb-3 text-xl">Bibliotek</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-ink-mute">Ingen bilder ennå.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((a) => (
              <li key={a.id}>
                <button onClick={() => setSelected(a.id)} className={cx("relative block w-full overflow-hidden rounded-xl bg-wood-50 ring-1", selected === a.id ? "ring-2 ring-wood-600" : "ring-line")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.url && <img src={a.url} alt={KIND[a.kind]} className="aspect-square w-full object-cover" />}
                  <span className="absolute bottom-1.5 left-1.5 flex gap-1">
                    <span className="rounded bg-black/55 px-1.5 text-[10px] text-white">{KIND[a.kind]}</span>
                    {a.ai && <span className="rounded bg-violet-700/80 px-1.5 text-[10px] text-white">AI</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FormatSelect({ formats, value, onChange }: { formats: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Format" htmlFor="fmt">
      <Select id="fmt" value={value} onChange={(e) => onChange(e.target.value)}>
        {formats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
