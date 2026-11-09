"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui";
import { resizeForUpload } from "@/lib/client/resize-image";
import { analyzeLibraryAsset, createVideoUpload, pendingLibraryIds, registerVideo, updateLibraryInfo, uploadLibraryImage } from "./actions";
import { extractVideoInfo } from "@/lib/client/video-frames";
import { formatDuration } from "@/lib/media/video";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { deleteAsset } from "../bilder/actions";

interface Item {
  id: string;
  url: string | null;
  thumbUrl: string | null;
  isVideo: boolean;
  duration: number | null;
  description: string | null;
  tags: string[];
  category: string | null;
  productId: string | null;
  peopleVisible: boolean;
  status: "none" | "pending" | "done" | "failed";
  error: string | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export function MediaLibrary({ aiReady, categories, products, assets }: { aiReady: boolean; categories: { id: string; label: string }[]; products: { id: string; name: string }[]; assets: Item[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [filter, setFilter] = useState<string>("alle");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const busy = progress !== null;
  const catLabel = (id: string | null) => categories.find((c) => c.id === id)?.label ?? "Ukategorisert";

  const analyzeQueue = async (ids: string[]) => {
    if (!aiReady || !ids.length) return;
    for (let i = 0; i < ids.length; i++) {
      setProgress({ phase: "Claude beskriver bildene", done: i, total: ids.length });
      const r = await analyzeLibraryAsset(ids[i]!);
      if (!r.ok) setErrors((e) => [...e, r.error]);
      if (i % 3 === 2) router.refresh();
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErrors([]);
    const list = Array.from(files).slice(0, 100);
    const uploaded: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      const isVideo = file.type.startsWith("video/");
      setProgress({ phase: isVideo ? `Laster opp video (${file.name})` : "Laster opp", done: i, total: list.length });
      try {
        if (isVideo) {
          await uploadVideo(file);
          continue;
        }
        const small = await resizeForUpload(file);
        const fd = new FormData();
        fd.append("file", small);
        const r = await uploadLibraryImage(fd);
        if (r.ok && r.data) uploaded.push(r.data.id);
        else if (!r.ok) setErrors((e) => [...e, r.error]);
      } catch (e) {
        setErrors((x) => [...x, (e as Error).message]);
      }
    }
    router.refresh();
    await analyzeQueue(uploaded);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  };

  /** Video: stillbilder i nettleseren → engangslenke → direkte til lagringen → registrering og beskrivelse. */
  const uploadVideo = async (file: File) => {
    const info = await extractVideoInfo(file);
    const type = file.type === "video/quicktime" ? "video/quicktime" : "video/mp4";
    const start = await createVideoUpload({ name: file.name, size: file.size, type });
    if (!start.ok || !start.data) throw new Error(start.ok ? "Kunne ikke starte opplasting" : start.error);
    const supabase = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await supabase.storage.from("media").uploadToSignedUrl(start.data.path, start.data.token, file, { contentType: type });
    if (error) throw new Error(`${file.name}: opplasting feilet (${error.message})`);
    const fd = new FormData();
    fd.append("path", start.data.path);
    if (info.duration) fd.append("duration", String(info.duration));
    if (info.width) fd.append("width", String(info.width));
    if (info.height) fd.append("height", String(info.height));
    info.frames.forEach((f, i) => fd.append("frames", new File([f], `frame-${i}.jpg`, { type: "image/jpeg" })));
    const r = await registerVideo(fd);
    if (!r.ok) throw new Error(r.error);
    if (!info.frames.length) setErrors((e) => [...e, `${file.name}: lastet opp, men nettleseren kunne ikke lese videoen – skriv beskrivelsen selv.`]);
  };

  const analyzePending = async () => {
    setErrors([]);
    const ids = await pendingLibraryIds();
    await analyzeQueue(ids);
    setProgress(null);
    router.refresh();
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter === "uten" && a.category) return false;
      if (filter !== "alle" && filter !== "uten" && a.category !== filter) return false;
      if (!q) return true;
      return (a.description ?? "").toLowerCase().includes(q) || a.tags.some((t) => t.includes(q));
    });
  }, [assets, filter, query]);
  const pendingCount = assets.filter((a) => a.status !== "done").length;
  const sel = assets.find((a) => a.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg">Last opp bilder og videoer</h2>
            <p className="text-sm text-ink-soft">
              Velg mange om gangen fra mobilen eller PC-en. Bildene gjøres mindre før opplasting, og posisjon og annen metadata fjernes. Videoer (MP4/MOV, maks {process.env.NEXT_PUBLIC_MAX_VIDEO_MB ?? 50} MB) lastes direkte til den private lagringen. Stående videoer på 3–90 sekunder kan publiseres som Reels.
            </p>
          </div>
          <Button disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "Arbeider …" : "Velg bilder og videoer"}
          </Button>
          <input ref={inputRef} type="file" accept="image/*,video/mp4,video/quicktime" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} aria-label="Velg bilder og videoer" />
        </div>
        {progress && (
          <div aria-live="polite">
            <p className="text-sm text-ink-soft">
              {progress.phase}: {progress.done + 1} av {progress.total}
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-wood-100">
              <div className="h-full bg-wood-600 transition-all" style={{ width: `${Math.round(((progress.done + 1) / progress.total) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-mute">Hold siden åpen til det er ferdig. Bilder som ikke rekker å bli beskrevet, kan beskrives senere.</p>
          </div>
        )}
        {!busy && aiReady && pendingCount > 0 && (
          <Button variant="secondary" onClick={analyzePending} className="self-start">
            Beskriv {pendingCount} bilde(r) som mangler beskrivelse
          </Button>
        )}
        {errors.length > 0 && (
          <Notice tone="error" title="Noen bilder feilet">
            <ul className="ml-4 list-disc">
              {[...new Set(errors)].slice(0, 5).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}
      </Card>

      {assets.length === 0 ? (
        <EmptyState title="Mediebanken er tom">Last opp bilder fra verkstedet, når du graverer, eller av produkter i hyllene. Claude bruker dem når det lager innlegg.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Søk i beskrivelser og stikkord" aria-label="Søk" className="sm:max-w-xs" />
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {[{ id: "alle", label: `Alle (${assets.length})` }, ...categories.filter((c) => assets.some((a) => a.category === c.id)), ...(assets.some((a) => !a.category) ? [{ id: "uten", label: "Uten beskrivelse" }] : [])].map((c) => (
                <button key={c.id} onClick={() => setFilter(c.id)} className={cx("shrink-0 rounded-full px-3 py-1.5 text-sm ring-1 ring-inset", filter === c.id ? "bg-wood-700 text-white ring-wood-700" : "bg-paper text-ink-soft ring-line")}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => {
                      setSelected(a.id);
                      // På mobil ligger redigeringen under bildene – rull dit.
                      if (window.innerWidth < 1024) requestAnimationFrame(() => document.getElementById("media-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                    }} className={cx("block w-full overflow-hidden rounded-xl bg-paper text-left ring-1", selected === a.id ? "ring-2 ring-wood-600" : "ring-line")}>
                    <span className="relative block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {(a.isVideo ? a.thumbUrl : a.url) ? <img src={(a.isVideo ? a.thumbUrl : a.url) ?? undefined} alt={a.description ?? ""} className="aspect-square w-full bg-wood-50 object-cover" loading="lazy" /> : <span className="grain block aspect-square w-full bg-wood-50" />}
                      {a.isVideo && (
                        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">▶ {formatDuration(a.duration)}</span>
                      )}
                    </span>
                    <div className="p-2">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-wood-700">{a.status === "done" ? catLabel(a.category) : a.status === "failed" ? "Beskrivelse feilet" : "Venter på beskrivelse"}</p>
                      <p className="line-clamp-2 text-xs text-ink-soft">{a.description ?? "–"}</p>
                      {a.useCount > 0 && <p className="mt-1 text-[11px] text-ink-mute">Brukt {a.useCount} gang(er)</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div id="media-editor" className="scroll-mt-20 lg:sticky lg:top-6 lg:self-start">
              {sel ? <Editor key={sel.id} item={sel} categories={categories} products={products} aiReady={aiReady} onDeleted={() => setSelected(null)} /> : <p className="text-sm text-ink-mute">Trykk på et bilde for å se og rette beskrivelsen.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Editor({ item, categories, products, aiReady, onDeleted }: { item: Item; categories: { id: string; label: string }[]; products: { id: string; name: string }[]; aiReady: boolean; onDeleted: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [description, setDescription] = useState(item.description ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [category, setCategory] = useState(item.category ?? "");
  const [productId, setProductId] = useState(item.productId ?? "");
  const [people, setPeople] = useState(item.peopleVisible);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: (r.ok ? r.message : r.error) ?? "" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return (
    <Card className="flex flex-col gap-3 p-4">
      {item.isVideo ? (
        item.url && <video src={item.url} poster={item.thumbUrl ?? undefined} controls playsInline preload="metadata" className="max-h-80 w-full rounded-xl bg-black" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        item.url && <img src={item.url} alt={item.description ?? ""} className="max-h-72 w-full rounded-xl bg-wood-50 object-contain" />
      )}
      <div className="flex flex-wrap gap-1.5">
        {item.peopleVisible && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Personer synlige – krever samtykke</Badge>}
        {item.lastUsedAt && <Badge className="bg-wood-50 text-wood-800 ring-wood-200">Sist brukt {new Date(item.lastUsedAt).toLocaleDateString("nb-NO")}</Badge>}
      </div>
      {item.status === "failed" && item.error && <Notice tone="error">{item.error}</Notice>}
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}
      <Field label="Beskrivelse" htmlFor="md">
        <Textarea id="md" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Stikkord" htmlFor="mt" hint="Skill med komma">
        <Input id="mt" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kategori" htmlFor="mc">
          <Select id="mc" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Velg …</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Produkt" htmlFor="mp">
          <Select id="mp" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Ingen</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} className="size-4 accent-wood-700" /> Personer er synlige på bildet
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            run(() =>
              updateLibraryInfo({
                id: item.id,
                description,
                tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                category: (category || null) as never,
                product_id: productId || null,
                people_visible: people,
              }),
            )
          }
        >
          Lagre
        </Button>
        {aiReady && (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => analyzeLibraryAsset(item.id))}>
            Beskriv på nytt
          </Button>
        )}
        <Button variant="danger" disabled={pending} onClick={() => confirm("Slette bildet fra mediebanken?") && run(() => deleteAsset(item.id), onDeleted)}>
          Slett
        </Button>
      </div>
    </Card>
  );
}
