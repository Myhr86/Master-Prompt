import type { Metadata } from "next";
import { BrandMark } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logg inn" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="grain relative hidden overflow-hidden bg-wood-100 lg:flex lg:flex-col lg:justify-between lg:p-14">
        <BrandMark />
        <div className="max-w-md">
          <p className="font-display text-4xl leading-tight text-wood-900">Personlige produkter fortjener personlige innlegg.</p>
          <p className="mt-4 text-wood-800/80">
            Planlegg, skriv og godkjenn Facebook-innlegg med hjelp fra AI – men ingenting publiseres uten at du har sagt ja.
          </p>
        </div>
        <p className="text-xs text-wood-700/70">Privat system · kun for autorisert eier</p>
      </section>
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <BrandMark />
          </div>
          <h1 className="text-3xl">Velkommen tilbake</h1>
          <p className="mb-8 mt-2 text-ink-soft">Logg inn for å fortsette.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
