"use client";

import { useActionState } from "react";
import { saveSettings } from "./actions";
import { Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { WEEKDAYS_NB } from "@/lib/dates";
import type { BusinessSettings } from "@/lib/types";

export function SettingsForm({
  settings,
  products,
  seasons,
  imageProviders,
}: {
  settings: BusinessSettings;
  products: { id: string; name: string; active: boolean }[];
  seasons: { key: string; name: string; enabled: boolean }[];
  imageProviders: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  return (
    <form action={action} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-lg">Bedrift og merkevare</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bedriftsnavn" htmlFor="business_name">
            <Input id="business_name" name="business_name" defaultValue={settings.business_name} required />
          </Field>
          <Field label="Nettadresse" htmlFor="website">
            <Input id="website" name="website" type="url" defaultValue={settings.website} required />
          </Field>
        </div>
        <Field label="Merkevarens skrivestil" htmlFor="brand_voice" hint="Claude følger denne beskrivelsen når innlegg skrives.">
          <Textarea id="brand_voice" name="brand_voice" rows={5} defaultValue={settings.brand_voice} maxLength={4000} />
        </Field>
        <Field label="Faste emneknagger" htmlFor="default_hashtags">
          <Input id="default_hashtags" name="default_hashtags" defaultValue={settings.default_hashtags.join(" ")} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-lg">Publiseringsplan</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Antall innlegg per uke" htmlFor="posting_frequency">
            <Input id="posting_frequency" name="posting_frequency" type="number" min={1} max={14} defaultValue={settings.posting_frequency} />
          </Field>
          <Field label="Foretrukne klokkeslett" htmlFor="preferred_times" hint="TT:MM, flere skilles med komma">
            <Input id="preferred_times" name="preferred_times" defaultValue={settings.preferred_times.join(", ")} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Foretrukne publiseringsdager og ukens tema</legend>
          <ul className="mt-2 flex flex-col gap-2">
            {WEEKDAYS_NB.map((d, i) => (
              <li key={d} className="grid grid-cols-[7rem_1fr] items-center gap-3">
                <label className="flex items-center gap-2 text-sm capitalize">
                  <input type="checkbox" name="preferred_days" value={i + 1} defaultChecked={settings.preferred_days.includes(i + 1)} className="size-4 accent-wood-700" />
                  {d}
                </label>
                <Input name={`theme_${i + 1}`} aria-label={`Tema ${d}`} defaultValue={settings.weekly_plan.find((w) => w.day === i + 1)?.theme ?? ""} placeholder="Tema (valgfritt)" maxLength={80} />
              </li>
            ))}
          </ul>
        </fieldset>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-lg">Innhold</h2>
        <fieldset>
          <legend className="text-sm font-medium">Produkter som skal prioriteres</legend>
          {products.length === 0 ? (
            <p className="mt-1 text-sm text-ink-mute">Ingen produkter i biblioteket ennå.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {products.map((p) => (
                <label key={p.id} className="cursor-pointer">
                  <input type="checkbox" name="prioritized_product_ids" value={p.id} defaultChecked={settings.prioritized_product_ids.includes(p.id)} className="peer sr-only" />
                  <span className="inline-flex min-h-9 items-center rounded-full bg-paper px-3 text-sm text-ink-soft ring-1 ring-line peer-checked:bg-moss-600 peer-checked:text-white">
                    {p.name}
                    {!p.active && " (inaktiv)"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Sesongbaserte kampanjer som kan foreslås</legend>
          <p className="text-xs text-ink-mute">Forslag er aldri aktive kampanjer eller tilbud – de må godkjennes som vanlige innlegg.</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {seasons.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`season_${s.key}`} defaultChecked={s.enabled} className="size-4 accent-wood-700" />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-lg">AI og bilder</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="AI-modell (Claude)" htmlFor="ai_model" hint="Standard: claude-opus-5-5">
            <Input id="ai_model" name="ai_model" defaultValue={settings.ai_model} />
          </Field>
          <Field label="Bildegenereringstjeneste" htmlFor="image_provider">
            <Select id="image_provider" name="image_provider" defaultValue={settings.image_provider}>
              {imageProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-lg">Sporing av trafikk til nettbutikken</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="utm_enabled" defaultChecked={settings.utm_enabled ?? true} className="mt-0.5 size-4 accent-wood-700" />
          <span>
            <span className="font-medium">Legg sporingskode (UTM) på lenker til nettbutikken</span>
            <span className="block text-ink-soft">Da kan du se i Shopify hvilke innlegg som gir besøk og salg. Gjelder nye og redigerte innlegg.</span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kilde (utm_source)" htmlFor="utm_source">
            <Input id="utm_source" name="utm_source" defaultValue={settings.utm_source ?? "facebook"} maxLength={40} />
          </Field>
          <Field label="Medium (utm_medium)" htmlFor="utm_medium">
            <Input id="utm_medium" name="utm_medium" defaultValue={settings.utm_medium ?? "social"} maxLength={40} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-lg">Testmodus</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="test_mode" defaultChecked={settings.test_mode} className="mt-0.5 size-4 accent-wood-700" />
          <span>
            <span className="font-medium">Simuler publisering</span>
            <span className="block text-ink-soft">Når dette er på, kjøres alle kontroller, men ingenting sendes til Facebook. Anbefales til du har testet tilkoblingen.</span>
          </span>
        </label>
      </Card>

      {state && <Notice tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Notice>}
      <div className="sticky bottom-20 z-10 flex justify-end lg:bottom-4">
        <Button type="submit" disabled={pending} className="shadow-lift">
          {pending ? "Lagrer …" : "Lagre innstillinger"}
        </Button>
      </div>
    </form>
  );
}
