import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { getFacebookStatus, getPagePostStats, getProducts, getSettings } from "@/lib/data";
import { integrations } from "@/lib/env";
import { Notice, PageHeader } from "@/components/ui";
import { GenerateForm } from "./generate-form";
import { QuickSuggest } from "./quick-suggest";
import { POST_TYPES, POST_TYPE_LABEL } from "@/lib/ai/schemas";
import { osloParts, addDays } from "@/lib/dates";
import { upcomingSeasonalEvents } from "@/lib/calendar/seasons";

export const metadata: Metadata = { title: "Lag innlegg" };
export const maxDuration = 300;

export default async function GeneratePage({ searchParams }: { searchParams: Promise<{ anledning?: string }> }) {
  await requireOwnerPage();
  const { anledning } = await searchParams;
  const [settings, products, pagePosts, fb] = await Promise.all([getSettings(), getProducts({ activeOnly: true }), getPagePostStats(), getFacebookStatus()]);
  const integ = integrations();
  const todayKey = osloParts(new Date()).dateKey;
  const occasion = anledning ? upcomingSeasonalEvents(todayKey, addDays(todayKey, 365)).find((e) => e.key === anledning) : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="AI-innholdsprodusent"
        title="Lag nye innlegg"
        subtitle="Claude skriver forslag basert på produktbiblioteket, tidligere innlegg og kommende merkedager. Alle forslag havner i godkjenningskøen – ingenting publiseres automatisk."
      />
      {!integ.anthropic && (
        <div className="mb-5">
          <Notice tone="warn" title="Claude er ikke konfigurert">
            Legg inn <code>ANTHROPIC_API_KEY</code> i miljøvariablene (Vercel → Settings → Environment Variables) og publiser på nytt. Se README, avsnittet «Anthropic API».
          </Notice>
        </div>
      )}
      {fb?.connection_status === "connected" && (pagePosts?.count ?? 0) === 0 && (
        <div className="mb-5">
          <Notice tone="info" title="Claude kjenner ikke innleggene på Facebook-siden ennå">
            Gå til Innstillinger → Facebook-tilkobling og trykk «Hent eksisterende innlegg», så unngår Claude å gjenta det som allerede er publisert.
          </Notice>
        </div>
      )}
      {(pagePosts?.count ?? 0) > 0 && (
        <p className="mb-5 text-sm text-ink-soft">
          Claude tar hensyn til {pagePosts!.count} innlegg fra Facebook-siden og innleggene i appen, og velger det som er naturlig å poste nå.
        </p>
      )}
      {products.length === 0 && (
        <div className="mb-5">
          <Notice tone="info" title="Produktbiblioteket er tomt">
            Uten produkter skriver Claude generelle innlegg om bedriften og håndverket, uten konkrete produktopplysninger eller priser. Legg inn produkter for mer treffsikre innlegg.
          </Notice>
        </div>
      )}
      <div className="mb-6">
        <QuickSuggest disabled={!integ.anthropic} />
      </div>
      <h2 className="mb-3 text-xl">Eller lag flere innlegg</h2>
      <GenerateForm
        defaultCount={settings.posting_frequency}
        disabled={!integ.anthropic}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        postTypes={POST_TYPES.map((t) => ({ id: t, label: POST_TYPE_LABEL[t] }))}
        defaultStart={occasion ? (addDays(occasion.date, -occasion.leadDays) > todayKey ? addDays(occasion.date, -occasion.leadDays) : addDays(todayKey, 1)) : addDays(todayKey, 1)}
        defaultInstructions={occasion ? `Lag innlegg til ${occasion.name} (${occasion.date}): ${occasion.angle}. Ikke nevn tilbud, rabatter eller frister som ikke er bekreftet.` : ""}
      />
    </div>
  );
}
