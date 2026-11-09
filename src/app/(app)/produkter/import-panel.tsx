"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importAllFromStore, importImagesForProductsWithoutImages, importOneFromUrl } from "./actions";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

export function ImportPanel({ website }: { website: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [url, setUrl] = useState("");
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) router.refresh();
    });
  return (
    <Card className="p-5">
      <h2 className="text-lg">Hent fra nettbutikken</h2>
      <p className="mt-1 text-sm text-ink-soft">Leser offentlig produktinformasjon fra {new URL(website).hostname}. Nye produkter legges inn som inaktive til du har kontrollert dem.</p>
      {result && <div className="mt-3"><Notice tone={result.ok ? "success" : "error"}>{result.ok ? result.message : result.error}</Notice></div>}
      <Button variant="secondary" className="mt-4 w-full" disabled={pending} onClick={() => run(importAllFromStore)}>
        {pending ? "Henter …" : "Hent alle produkter / se etter endringer"}
      </Button>
      <Button variant="secondary" className="mt-2 w-full" disabled={pending} onClick={() => run(importImagesForProductsWithoutImages)}>
        Hent bilder for produkter uten bilder
      </Button>
      <div className="mt-4 flex flex-col gap-2">
        <Field label="…eller én produktside" htmlFor="purl">
          <Input id="purl" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`${website.replace(/\/$/, "")}/products/…`} />
        </Field>
        <Button variant="secondary" disabled={pending || !url} onClick={() => run(() => importOneFromUrl(url))}>
          Hent produktside
        </Button>
      </div>
    </Card>
  );
}
