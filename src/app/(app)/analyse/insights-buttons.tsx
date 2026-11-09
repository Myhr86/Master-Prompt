"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { applyRecommendedTimes, classifyPagePostsNow } from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: (r.ok ? r.message : r.error) ?? "" });
      if (r.ok) router.refresh();
    });
  return { pending, msg, run };
}

export function ApplyTimesButton({ days, time }: { days: number[]; time: string }) {
  const { pending, msg, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <Button variant="success" disabled={pending} onClick={() => run(() => applyRecommendedTimes(days, time))} className="self-start">
        {pending ? "Lagrer …" : "Bruk disse tidene"}
      </Button>
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}
    </div>
  );
}

export function ClassifyButton() {
  const { pending, msg, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" disabled={pending} onClick={() => run(classifyPagePostsNow)} className="self-start">
        {pending ? "Claude leser innleggene …" : "Anslå innleggstype"}
      </Button>
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}
    </div>
  );
}
