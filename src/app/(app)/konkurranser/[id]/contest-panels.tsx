"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice, Textarea } from "@/components/ui";
import { deleteContest, drawContest, setContestStatus } from "../actions";

export function DrawPanel({ id, ended, status, winners, entries, drawnAt, listHash }: { id: string; ended: boolean; status: string; winners: string[]; entries: number | null; drawnAt: string | null; listHash: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [raw, setRaw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const count = raw.split(/\r?\n/).filter((l) => l.trim()).length;

  if (status === "trukket") {
    return (
      <Card className="p-5">
        <h2 className="text-lg">Trekning</h2>
        <p className="mt-2 text-2xl font-display">🎉 {winners.join(", ")}</p>
        <p className="mt-1 text-sm text-ink-soft">
          Trukket tilfeldig blant {entries} deltakere {drawnAt ? `(${new Date(drawnAt).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })})` : ""}. Navnet er satt inn i vinnerinnlegget – gå dit for å godkjenne.
        </p>
        {listHash && <p className="mt-2 break-all text-[11px] text-ink-mute">Kontrollsum for deltakerlisten: {listHash}</p>}
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <h2 className="text-lg">Trekk vinner</h2>
      {!ended ? (
        <p className="mt-1 text-sm text-ink-soft">Trekningen åpner når fristen har gått ut.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            Kopier navnene til alle som har deltatt riktig fra kommentarfeltet på Facebook og lim dem inn – ett navn per linje. Duplikater fjernes automatisk. Listen lagres ikke.
          </p>
          <Textarea className="mt-3" rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"Kari Nordmann\nOla Hansen\n…"} aria-label="Deltakere" />
          <p className="mt-1 text-xs text-ink-mute">{count} linje(r)</p>
          {msg && <div className="mt-2"><Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice></div>}
          <Button
            className="mt-3"
            disabled={pending || count === 0}
            onClick={() =>
              confirm(`Trekke vinner blant ${count} deltakere? Trekningen kan ikke gjøres om.`) &&
              start(async () => {
                const r = await drawContest(id, raw);
                setMsg({ ok: r.ok, text: r.ok ? `Vinner: ${r.data!.winners.join(", ")} (blant ${r.data!.entries} deltakere)` : r.error });
                if (r.ok) {
                  setRaw("");
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Trekker …" : "Trekk vinner"}
          </Button>
        </>
      )}
    </Card>
  );
}

export function ContestActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
    <Card className="p-5">
      <h2 className="text-lg">Status</h2>
      {msg && <div className="mt-2"><Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {status === "utkast" && (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => setContestStatus(id, "aktiv"))}>
            Merk som aktiv
          </Button>
        )}
        {status !== "trukket" && status !== "avlyst" && (
          <Button variant="secondary" disabled={pending} onClick={() => confirm("Avlyse konkurransen?") && run(() => setContestStatus(id, "avlyst"))}>
            Avlys
          </Button>
        )}
        <Button variant="danger" disabled={pending} onClick={() => confirm("Slette konkurransen og innlegg som ikke er publisert?") && run(() => deleteContest(id), () => router.push("/konkurranser"))}>
          Slett
        </Button>
      </div>
    </Card>
  );
}
