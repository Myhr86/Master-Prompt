"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { saveProduct } from "./actions";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import type { Product } from "@/lib/types";

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveProduct>> | undefined, fd: FormData) => {
    const r = await saveProduct(prev, fd);
    if (r.ok && !product && r.data) router.push(`/produkter/${r.data.id}`);
    else if (r.ok) router.refresh();
    return r;
  }, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {product && <input type="hidden" name="id" value={product.id} />}
      {state && <Notice tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Notice>}
      <Field label="Produktnavn" htmlFor="name">
        <Input id="name" name="name" required maxLength={300} defaultValue={product?.name} />
      </Field>
      <Field label="Beskrivelse" htmlFor="description">
        <Textarea id="description" name="description" rows={5} maxLength={10000} defaultValue={product?.description} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pris (NOK)" htmlFor="price" hint="La stå tomt hvis du ikke vil oppgi pris.">
          <Input id="price" name="price" inputMode="decimal" defaultValue={product?.price ?? ""} />
        </Field>
        <Field label="Produktlenke" htmlFor="product_url">
          <Input id="product_url" name="product_url" type="url" placeholder="https://myhrtreogdesign.com/…" defaultValue={product?.product_url ?? ""} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={product ? product.active : true} className="size-4 accent-wood-700" /> Aktiv (kan brukes i innlegg)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="needs_verification" defaultChecked={product?.needs_verification ?? false} className="size-4 accent-wood-700" /> Opplysningene må bekreftes
      </label>
      <Field label="Merknad om hva som må bekreftes" htmlFor="verification_note">
        <Input id="verification_note" name="verification_note" maxLength={1000} defaultValue={product?.verification_note ?? ""} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Lagrer …" : product ? "Lagre produkt" : "Opprett produkt"}
      </Button>
    </form>
  );
}
