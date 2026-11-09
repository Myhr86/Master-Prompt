"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveProposal } from "./actions";
import { Button, Card, Notice } from "@/components/ui";

const FIELD: Record<string, string> = { name: "Navn", description: "Beskrivelse", price: "Pris", product_url: "Lenke", active: "Aktiv" };

export function ProposalList({ proposals }: { proposals: { id: string; productName: string; field: string; current_value: string | null; proposed_value: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="mb-6 p-5 ring-amber-200">
      <h2 className="text-lg">Endringer oppdaget i nettbutikken</h2>
      <p className="mt-1 text-sm text-ink-soft">Produktdataene bør kanskje oppdateres. Ingenting endres før du godtar.</p>
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
      <ul className="mt-4 flex flex-col gap-3">
        {proposals.map((p) => (
          <li key={p.id} className="rounded-2xl bg-amber-50/60 p-4 text-sm">
            <p className="font-medium">
              {p.productName} – {FIELD[p.field] ?? p.field}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-ink-mute">Nå</p>
                <p className="line-clamp-4 whitespace-pre-line">{p.current_value ?? "–"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-ink-mute">I nettbutikken</p>
                <p className="line-clamp-4 whitespace-pre-line">{p.proposed_value ?? "–"}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="success" disabled={pending} onClick={() => start(async () => { const r = await resolveProposal(p.id, true); if (!r.ok) setError(r.error); router.refresh(); })}>
                Godta
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await resolveProposal(p.id, false); if (!r.ok) setError(r.error); router.refresh(); })}>
                Behold nåværende
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
