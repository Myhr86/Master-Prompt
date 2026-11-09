import Link from "next/link";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProducts, getSettings } from "@/lib/data";
import { signedUrls } from "@/lib/images/storage";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ImportPanel } from "./import-panel";
import { ProposalList } from "./proposal-list";
import { ProductForm } from "./product-form";

export const metadata: Metadata = { title: "Produkter" };

const nok = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" });

export default async function ProductsPage() {
  await requireOwnerPage();
  const supabase = await createClient();
  const [products, settings, imagesRes, proposalsRes] = await Promise.all([
    getProducts(),
    getSettings(),
    supabase.from("product_images").select("product_id, storage_path, is_primary").order("is_primary", { ascending: false }),
    supabase.from("product_change_proposals").select("id, product_id, field, current_value, proposed_value, detected_at").eq("status", "pending").order("detected_at", { ascending: false }),
  ]);
  const firstImage = new Map<string, string>();
  for (const i of imagesRes.data ?? []) if (!firstImage.has(i.product_id)) firstImage.set(i.product_id, i.storage_path);
  const urls = await signedUrls([...firstImage.values()]);
  const proposals = (proposalsRes.data ?? []).map((p) => ({ ...p, productName: products.find((x) => x.id === p.product_id)?.name ?? "Ukjent" }));

  return (
    <div>
      <PageHeader
        eyebrow="Sannhetskilde"
        title="Produktbibliotek"
        subtitle="Claude bruker kun opplysningene her når innlegg skrives. Endringer fra nettbutikken blir forslag som du må godta."
      />

      {proposals.length > 0 && <ProposalList proposals={proposals} />}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section aria-label="Produkter">
          {products.length === 0 ? (
            <EmptyState title="Ingen produkter ennå">Hent produkter fra nettbutikken eller legg dem inn manuelt.</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {products.map((p) => {
                const img = firstImage.get(p.id);
                return (
                  <li key={p.id}>
                    <Link href={`/produkter/${p.id}`}>
                      <Card className="flex h-full gap-3 p-3 transition-shadow hover:shadow-lift">
                        <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-wood-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {img && urls[img] && <img src={urls[img]} alt="" className="size-full object-cover" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="text-sm text-ink-soft">{p.price === null ? "Pris ikke oppgitt" : nok.format(Number(p.price))}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {!p.active && <Badge className="bg-stone-100 text-stone-700 ring-stone-200">Inaktiv</Badge>}
                            {p.needs_verification && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Må bekreftes</Badge>}
                            {settings.prioritized_product_ids.includes(p.id) && <Badge className="bg-moss-50 text-moss-700 ring-moss-100">Prioritert</Badge>}
                          </div>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <aside className="flex flex-col gap-6">
          <ImportPanel website={settings.website} />
          <Card className="p-5">
            <h2 className="text-lg">Nytt produkt</h2>
            <p className="mt-1 text-sm text-ink-soft">Legg bare inn opplysninger du vet stemmer.</p>
            <div className="mt-4">
              <ProductForm />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
