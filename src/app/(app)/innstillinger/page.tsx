import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { getFacebookStatus, getProducts, getSettings } from "@/lib/data";
import { env, integrations } from "@/lib/env";
import { seasonalEventsForYear } from "@/lib/calendar/seasons";
import { IMAGE_PROVIDER_OPTIONS } from "@/lib/images/providers";
import { effectivePublishMode } from "@/lib/posts/mode";
import { Card, Notice, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { FacebookPanel } from "./facebook-panel";

export const metadata: Metadata = { title: "Innstillinger" };

const FB_MESSAGES: Record<string, { tone: "success" | "error" | "warn"; text: string }> = {
  tilkoblet: { tone: "success", text: "Facebook-siden er tilkoblet." },
  avbrutt: { tone: "warn", text: "Tilkoblingen ble avbrutt hos Facebook." },
  "ugyldig-state": { tone: "error", text: "Sikkerhetskontrollen feilet (ugyldig state). Prøv på nytt." },
  "mangler-tillatelser": { tone: "error", text: "Du ga ikke alle nødvendige tillatelser. Systemet trenger pages_show_list, pages_manage_posts og pages_read_engagement." },
  feil: { tone: "error", text: "Noe gikk galt under tilkoblingen. Prøv igjen." },
  utlopt: { tone: "warn", text: "Tilkoblingsøkten utløp. Start på nytt." },
  "ikke-konfigurert": { tone: "warn", text: "Meta-appen er ikke konfigurert på serveren (META_APP_ID, META_APP_SECRET, META_GRAPH_API_VERSION)." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ fb?: string }> }) {
  await requireOwnerPage();
  const { fb: fbMsg } = await searchParams;
  const [settings, fb, products] = await Promise.all([getSettings(), getFacebookStatus(), getProducts()]);
  const integ = integrations();
  const mode = effectivePublishMode(settings.test_mode);
  const year = new Date().getFullYear();
  const seasons = seasonalEventsForYear(year);
  const msg = fbMsg ? FB_MESSAGES[fbMsg] : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Oppsett" title="Innstillinger" subtitle="Alt kan endres her uten å redigere kildekoden." />

      <section id="facebook" className="mb-6 scroll-mt-24">
        {msg && (
          <div className="mb-3">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        )}
        <FacebookPanel status={fb} metaConfigured={integ.meta} graphVersion={env().META_GRAPH_API_VERSION ?? null} />
      </section>

      <Card id="publisering" className="mb-6 scroll-mt-24 p-5">
        <h2 className="text-lg">Integrasjoner og publiseringsmodus</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          <Status ok={integ.anthropic} label="Claude (Anthropic API)" hint="ANTHROPIC_API_KEY" />
          <Status ok={integ.openaiImages} label="Bildegenerering (OpenAI Images API)" hint="OPENAI_API_KEY – valgfritt" />
          <Status ok={integ.meta} label="Meta-app (Facebook Login og Graph API)" hint="META_APP_ID, META_APP_SECRET, META_GRAPH_API_VERSION" />
          <Status ok={integ.livePublishingAllowed} label="Ekte publisering tillatt på serveren" hint="PUBLISH_MODE=live" />
        </ul>
        <div className="mt-4">
          <Notice tone={mode === "live" ? "success" : "info"} title={mode === "live" ? "Ekte publisering er aktiv" : "Testmodus: publisering simuleres"}>
            {mode === "live"
              ? "Godkjente innlegg publiseres på Facebook når du trykker «Publiser nå» eller ved planlagt tidspunkt."
              : `Alle kontroller kjøres, men ingenting sendes til Facebook. Ekte publisering krever PUBLISH_MODE=live på serveren${integ.livePublishingAllowed ? "" : " (ikke satt)"} og at testmodus slås av nedenfor.`}
          </Notice>
        </div>
      </Card>

      <SettingsForm
        settings={settings}
        products={products.map((p) => ({ id: p.id, name: p.name, active: p.active }))}
        seasons={seasons.map((s) => ({ key: s.key, name: s.name, enabled: settings.seasonal_campaigns.find((c) => c.key === s.key)?.enabled ?? true }))}
        imageProviders={IMAGE_PROVIDER_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
      />
    </div>
  );
}

function Status({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-1 size-2.5 shrink-0 rounded-full ${ok ? "bg-moss-500" : "bg-stone-300"}`} aria-hidden />
      <span>
        <span className="font-medium">{label}</span> – {ok ? "konfigurert" : "ikke konfigurert"}
        <span className="block text-xs text-ink-mute">{hint}</span>
      </span>
    </li>
  );
}
