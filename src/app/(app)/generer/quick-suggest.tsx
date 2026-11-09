"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { suggestOne } from "./actions";
import { Button, Input, Notice, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

/** «Foreslå ett innlegg for meg» – Claude velger det mest naturlige innlegget nå. */
export function QuickSuggest({ disabled, variant = "card" }: { disabled: boolean; variant?: "card" | "inline" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showWish, setShowWish] = useState(false);
  const [wish, setWish] = useState("");

  const run = () =>
    start(async () => {
      setError(null);
      const r = await suggestOne(wish);
      if (r.ok && r.data) router.push(`/innlegg/${r.data.id}`);
      else if (!r.ok) setError(r.error);
    });

  return (
    <div className={cx(variant === "card" && "rounded-card bg-wood-100 p-5 ring-1 ring-wood-200 sm:p-6")}>
      {variant === "card" && (
        <>
          <h2 className="text-xl text-wood-900">Usikker på hva du skal poste?</h2>
          <p className="mt-1 text-sm text-wood-900/75">
            La Claude velge det innlegget som passer best akkurat nå – ut fra det som nylig er publisert, produktene, årstiden og kommende anledninger. Du ser gjennom og godkjenner før noe publiseres.
          </p>
        </>
      )}
      <div className={cx("flex flex-wrap items-center gap-2", variant === "card" && "mt-4")}>
        <Button onClick={run} disabled={pending || disabled} variant={variant === "card" ? "primary" : "secondary"}>
          <Icon.sparkles /> {pending ? "Claude tenker … (inntil et par minutter)" : "Foreslå ett innlegg for meg"}
        </Button>
        {variant === "card" && !showWish && (
          <button type="button" className="text-sm text-wood-800 underline" onClick={() => setShowWish(true)} disabled={pending}>
            Har du et ønske?
          </button>
        )}
      </div>
      {showWish && (
        <div className="mt-3">
          <Input value={wish} onChange={(e) => setWish(e.target.value)} maxLength={500} placeholder="F.eks. noe om skjærefjøler, eller et innlegg til helgen" aria-label="Ønske til forslaget" disabled={pending} />
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
