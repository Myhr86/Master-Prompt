"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <Field label="E-post" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required inputMode="email" />
      </Field>
      <Field label="Passord" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
      </Field>
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Logger inn …" : "Logg inn"}
      </Button>
    </form>
  );
}
