"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzeWithClaude, refreshAnalytics } from "./actions";
import { Button, Card, Notice } from "@/components/ui";
import type { AnalysisResult } from "@/lib/ai/schemas";

export function AnalyticsActions({ canRefresh, canAnalyze }: { canRefresh: boolean; canAnalyze: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!canRefresh || pending} onClick={() => start(async () => { const r = await refreshAnalytics(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); router.refresh(); })}>
          Hent oppdatert statistikk
        </Button>
        <Button disabled={!canAnalyze || pending} onClick={() => start(async () => { const r = await analyzeWithClaude(); if (r.ok && r.data) { setAnalysis(r.data); setMsg(null); } else if (!r.ok) setMsg({ ok: false, text: r.error }); })}>
          {pending ? "Arbeider …" : "Be Claude om analyse og forslag"}
        </Button>
      </div>
      {!canAnalyze && <p className="text-xs text-ink-mute">AI-analyse krever statistikk for minst tre publiserte innlegg og konfigurert Claude.</p>}
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}
      {analysis && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-lg">Claudes vurdering</h2>
          <p className="text-sm">{analysis.summary}</p>
          <Section title="Innleggstyper som fungerer best" items={analysis.best_post_types.map((b) => `${b.post_type}: ${b.evidence}`)} />
          <Section title="Produkter som skaper interesse" items={analysis.product_interest.map((b) => `${b.product}: ${b.evidence}`)} />
          <Section title="Temaer å bruke mer" items={analysis.themes_to_use_more} />
          <Section title="Forbedringer" items={analysis.improvements} />
          <Notice tone="info" title="Begrensninger i datagrunnlaget">{analysis.data_limitations}</Notice>
        </Card>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <ul className="ml-4 mt-1 list-disc text-sm text-ink-soft">
        {items.map((i, n) => (
          <li key={n}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
