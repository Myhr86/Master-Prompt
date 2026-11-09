"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProduct, deleteProductImage, setPrimaryImage, uploadProductImage } from "../actions";
import { Button, Card, Field, Input, Notice, Select } from "@/components/ui";
import type { ProductImage } from "@/lib/types";
import type { ActionResult } from "@/lib/action-result";

const TYPE: Record<string, string> = { product_photo: "Produktfoto", detail: "Detalj", lifestyle: "Miljø", cutout: "Frilagt" };

export function ProductImages({ productId, images }: { productId: string; images: (ProductImage & { url: string | null })[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [state, action, uploading] = useActionState(async (prev: ActionResult | undefined, fd: FormData) => {
    const r = await uploadProductImage(prev, fd);
    if (r.ok) router.refresh();
    return r;
  }, undefined);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <h2 className="text-lg">Produktbilder</h2>
        <p className="mt-1 text-sm text-ink-soft">Ekte bilder brukes som referanse. Produktet endres aldri av AI – i miljøbilder legges dette bildet uendret oppå bakgrunnen.</p>
        {msg && <div className="mt-3"><Notice tone={msg.ok ? "success" : "error"}>{msg.ok ? msg.message : msg.error}</Notice></div>}
        {images.length > 0 ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((img) => (
              <li key={img.id} className="overflow-hidden rounded-xl ring-1 ring-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {img.url && <img src={img.url} alt={img.alt_text ?? ""} className="aspect-square w-full bg-wood-50 object-cover" />}
                <div className="flex flex-col gap-1 p-2 text-xs">
                  <span className="text-ink-soft">
                    {TYPE[img.image_type]} {img.is_primary && "· Hovedbilde"}
                  </span>
                  <div className="flex gap-2">
                    {!img.is_primary && (
                      <button className="text-wood-700 underline" disabled={pending} onClick={() => run(() => setPrimaryImage(productId, img.id))}>
                        Gjør til hovedbilde
                      </button>
                    )}
                    <button className="text-red-700 underline" disabled={pending} onClick={() => confirm("Slette bildet?") && run(() => deleteProductImage(productId, img.id))}>
                      Slett
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-ink-mute">Ingen bilder ennå.</p>
        )}

        <form action={action} className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
          <input type="hidden" name="product_id" value={productId} />
          {state && <Notice tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Notice>}
          <Field label="Last opp bilder" htmlFor="files" hint="JPEG, PNG eller WebP, maks 15 MB. Metadata (f.eks. GPS) fjernes automatisk.">
            <input id="files" name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-wood-100 file:px-4 file:py-2 file:text-wood-900" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bildetype" htmlFor="image_type">
              <Select id="image_type" name="image_type" defaultValue="product_photo">
                {Object.entries(TYPE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kort beskrivelse" htmlFor="alt_text">
              <Input id="alt_text" name="alt_text" maxLength={300} placeholder="F.eks. flis med familiebilde, hvit ramme" />
            </Field>
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? "Laster opp …" : "Last opp"}
          </Button>
        </form>
      </Card>
      <Card className="p-5">
        <h2 className="text-lg">Slett produkt</h2>
        <p className="mt-1 text-sm text-ink-soft">Innlegg som bruker produktet beholdes, men koblingen fjernes.</p>
        <Button variant="danger" className="mt-3" disabled={pending} onClick={() => confirm("Slette produktet og bildene?") && run(() => deleteProduct(productId), () => router.push("/produkter"))}>
          Slett produkt
        </Button>
      </Card>
    </div>
  );
}
