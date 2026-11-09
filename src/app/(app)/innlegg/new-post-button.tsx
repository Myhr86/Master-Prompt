"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { Button } from "@/components/ui";
import { createManualPost } from "./actions";

export function NewPostButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await createManualPost();
            if (r.ok && r.data) router.push(`/innlegg/${r.data.id}?rediger=1`);
            else if (!r.ok) setError(r.error);
          })
        }
      >
        {pending ? "Oppretter …" : "Skriv selv"}
      </Button>
      {error && <p className="w-full text-sm text-red-700">{error}</p>}
    </>
  );
}
