"use client";

import { useActionState } from "react";
import Link from "next/link";
import { generateWeek } from "./actions";
import { Button, Card, Field, Input, Notice, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";

export function GenerateForm({
  defaultCount,
  disabled,
  products,
  postTypes,
  defaultStart,
  defaultInstructions,
}: {
  defaultCount: number;
  disabled: boolean;
  products: { id: string; name: string }[];
  postTypes: { id: string; label: string }[];
  defaultStart: string;
  defaultInstructions?: string;
}) {
  const [state, action, pending] = useActionState(generateWeek, undefined);
  return (
    <form action={action} className="flex flex-col gap-5">
      {state && (
        <Notice tone={state.ok ? "success" : "error"} title={state.ok ? "Forslagene er klare" : undefined}>
          {state.ok ? (
            <>
              {state.message}{" "}
              <Link href="/innlegg?status=PENDING_APPROVAL" className="font-medium underline">
                Gå til godkjenning →
              </Link>
            </>
          ) : (
            state.error
          )}
        </Notice>
      )}
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Antall innlegg" htmlFor="count" hint="Standard er tre per uke.">
            <Input id="count" name="count" type="number" min={1} max={7} defaultValue={defaultCount} />
          </Field>
          <Field label="Fra og med dato" htmlFor="startDate">
            <Input id="startDate" name="startDate" type="date" defaultValue={defaultStart} />
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Innleggstyper (valgfritt)</legend>
          <p className="text-xs text-ink-mute">Velg ingen for en god blanding.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {postTypes.map((t) => (
              <label key={t.id} className="cursor-pointer">
                <input type="checkbox" name="postTypes" value={t.id} className="peer sr-only" />
                <span className="inline-flex min-h-9 items-center rounded-full bg-paper px-3 text-sm text-ink-soft ring-1 ring-line peer-checked:bg-wood-700 peer-checked:text-white peer-checked:ring-wood-700 peer-focus-visible:outline-2 peer-focus-visible:outline-wood-500">
                  {t.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {products.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium">Fokusprodukter (valgfritt)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {products.map((p) => (
                <label key={p.id} className="cursor-pointer">
                  <input type="checkbox" name="productIds" value={p.id} className="peer sr-only" />
                  <span className="inline-flex min-h-9 items-center rounded-full bg-paper px-3 text-sm text-ink-soft ring-1 ring-line peer-checked:bg-moss-600 peer-checked:text-white peer-checked:ring-moss-600">
                    {p.name}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Field label="Ekstra ønsker til Claude (valgfritt)" htmlFor="instructions">
          <Textarea id="instructions" name="instructions" rows={3} maxLength={1500} defaultValue={defaultInstructions} placeholder="F.eks. fokus på farsdag, eller fortell om hvordan flisene lages …" />
        </Field>

        <Button type="submit" disabled={pending || disabled} className="w-full sm:w-auto">
          <Icon.sparkles /> {pending ? "Claude skriver forslag … (kan ta et par minutter)" : "Generer forslag"}
        </Button>
      </Card>
    </form>
  );
}
