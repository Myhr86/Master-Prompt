"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createContest } from "./actions";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { buildRulesText } from "@/lib/contests/rules";
import { osloToUtc } from "@/lib/dates";

/** Tolker datetime-local som norsk tid – samme regel som serveren bruker. */
function previewIso(local: string): string {
  const [d, t] = local.split("T");
  if (!d || !t) return new Date().toISOString();
  const iso = osloToUtc(d, t);
  return Number.isNaN(iso.getTime()) ? new Date().toISOString() : iso.toISOString();
}

export function ContestForm({ products, businessName, aiReady, defaults }: { products: { id: string; name: string }[]; businessName: string; aiReady: boolean; defaults: { start: string; end: string; announce: string } }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createContest>> | undefined, fd: FormData) => {
    const r = await createContest(prev, fd);
    if (r.ok && r.data) router.push(`/konkurranser/${r.data.id}`);
    return r;
  }, undefined);
  const [f, setF] = useState({
    title: "",
    prize: "",
    prize_product_id: "",
    question: "",
    entry_method: "kommentar" as "kommentar" | "kommentar_like",
    min_age: 18,
    region: "Norge",
    starts_at: defaults.start,
    ends_at: defaults.end,
    announce_at: defaults.announce,
    winner_count: 1,
    delivery_note: "Premien sendes gratis til vinneren.",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value });
  const rules = useMemo(
    () =>
      buildRulesText({
        ...f,
        question: f.question || null,
        delivery_note: f.delivery_note || null,
        prize: f.prize || "[premie]",
        title: f.title,
        starts_at: previewIso(f.starts_at),
        ends_at: previewIso(f.ends_at),
        announce_at: previewIso(f.announce_at),
        business_name: businessName,
      }),
    [f, businessName],
  );

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      {state && !state.ok && <Notice tone="error">{state.error}</Notice>}
      <Field label="Tittel" htmlFor="title">
        <Input id="title" name="title" value={f.title} onChange={set("title")} placeholder="Vinn en familieflis med eget bilde" required maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Premie" htmlFor="prize">
          <Input id="prize" name="prize" value={f.prize} onChange={set("prize")} placeholder="Familieflis med eget bilde" required maxLength={500} />
        </Field>
        <Field label="Produkt (valgfritt)" htmlFor="prize_product_id">
          <Select
            id="prize_product_id"
            name="prize_product_id"
            value={f.prize_product_id}
            onChange={(e) => {
              const p = products.find((x) => x.id === e.target.value);
              setF({ ...f, prize_product_id: e.target.value, prize: f.prize || p?.name || "" });
            }}
          >
            <option value="">Ingen</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Spørsmål deltakerne svarer på (valgfritt)" htmlFor="question" hint="Et hyggelig spørsmål gir flere og bedre kommentarer.">
        <Input id="question" name="question" value={f.question} onChange={set("question")} placeholder="Hvilket bilde ville du gravert på flisen?" maxLength={300} />
      </Field>
      <Field label="Slik deltar man" htmlFor="entry_method" hint="Deling og tagging av venner er ikke tillatt som krav på Facebook, og tilbys derfor ikke.">
        <Select id="entry_method" name="entry_method" value={f.entry_method} onChange={set("entry_method")}>
          <option value="kommentar">Kommenterer innlegget</option>
          <option value="kommentar_like">Liker og kommenterer innlegget</option>
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Start (norsk tid)" htmlFor="starts_at">
          <Input id="starts_at" name="starts_at" type="datetime-local" value={f.starts_at} onChange={set("starts_at")} required />
        </Field>
        <Field label="Frist" htmlFor="ends_at">
          <Input id="ends_at" name="ends_at" type="datetime-local" value={f.ends_at} onChange={set("ends_at")} required />
        </Field>
        <Field label="Vinner kunngjøres" htmlFor="announce_at">
          <Input id="announce_at" name="announce_at" type="datetime-local" value={f.announce_at} onChange={set("announce_at")} required />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Antall vinnere" htmlFor="winner_count">
          <Input id="winner_count" name="winner_count" type="number" min={1} max={10} value={f.winner_count} onChange={set("winner_count")} />
        </Field>
        <Field label="Aldersgrense" htmlFor="min_age">
          <Input id="min_age" name="min_age" type="number" min={13} max={99} value={f.min_age} onChange={set("min_age")} />
        </Field>
        <Field label="Bosatt i" htmlFor="region">
          <Input id="region" name="region" value={f.region} onChange={set("region")} maxLength={100} />
        </Field>
      </div>
      <Field label="Om levering av premien" htmlFor="delivery_note">
        <Input id="delivery_note" name="delivery_note" value={f.delivery_note} onChange={set("delivery_note")} maxLength={300} />
      </Field>

      <div>
        <p className="text-sm font-medium">Vilkårene som legges til innlegget</p>
        <pre className="mt-1 whitespace-pre-wrap rounded-xl bg-wood-50 p-3 text-xs leading-relaxed text-ink">{rules}</pre>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? (aiReady ? "Claude skriver innleggene …" : "Lager …") : "Lag konkurranse og innlegg"}
      </Button>
      <p className="text-xs text-ink-mute">
        Det lages tre innlegg: kunngjøring, påminnelse dagen før fristen og vinnerkunngjøring. Alle venter på din godkjenning.
      </p>
    </form>
  );
}
