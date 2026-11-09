"use client";

import { useActionState } from "react";
import { cancelConnect, confirmPage } from "../actions";
import { Button, Notice } from "@/components/ui";

export function PagePicker({ pages }: { pages: { id: string; name: string; canPost: boolean }[] }) {
  const [state, action, pending] = useActionState(confirmPage, undefined);
  const preferred = pages.find((p) => /myhr/i.test(p.name))?.id ?? pages[0]?.id;
  return (
    <form action={action} className="flex flex-col gap-4">
      {state && !state.ok && <Notice tone="error">{state.error}</Notice>}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Facebook-sider</legend>
        {pages.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-2xl p-3 ring-1 ring-line has-[:checked]:bg-wood-50 has-[:checked]:ring-wood-400">
            <input type="radio" name="page_id" value={p.id} defaultChecked={p.id === preferred} disabled={!p.canPost} className="size-4 accent-wood-700" />
            <span className="flex-1">
              <span className="block font-medium">{p.name}</span>
              {!p.canPost && <span className="text-xs text-red-700">Du kan ikke publisere på denne siden</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-ink-mute">Systemet ber kun om: vise sidene dine, publisere innlegg på siden og lese engasjement. Ingen tilgang til meldinger, Messenger, personlig profil, annonsekontoer eller betaling.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Kobler til …" : "Bekreft tilkobling"}
        </Button>
        <Button type="submit" variant="ghost" formAction={cancelConnect} formNoValidate>
          Avbryt
        </Button>
      </div>
    </form>
  );
}
