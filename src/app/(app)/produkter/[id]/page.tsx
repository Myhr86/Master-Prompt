import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { requireOwnerPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/images/storage";
import { Card, Notice } from "@/components/ui";
import { ProductForm } from "../product-form";
import { ProductImages } from "./product-images";
import type { Product, ProductImage } from "@/lib/types";

export const metadata: Metadata = { title: "Produkt" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwnerPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: product }, { data: images }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("product_images").select("*").eq("product_id", id).order("is_primary", { ascending: false }).order("created_at"),
  ]);
  if (!product) notFound();
  const imgs = (images ?? []) as ProductImage[];
  const urls = await signedUrls(imgs.map((i) => i.storage_path));
  const p = product as Product;
  return (
    <div>
      <Link href="/produkter" className="text-sm text-ink-soft hover:text-ink">
        ← Produktbibliotek
      </Link>
      <h1 className="mb-6 mt-2 text-3xl">{p.name}</h1>
      {p.needs_verification && (
        <div className="mb-5">
          <Notice tone="warn" title="Må bekreftes">
            {p.verification_note ?? "Opplysningene er ikke bekreftet."} Fjern haken «må bekreftes» når alt stemmer{!p.active ? ", og aktiver produktet" : ""}.
          </Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-lg">Produktinformasjon</h2>
          <ProductForm product={p} />
        </Card>
        <ProductImages productId={p.id} images={imgs.map((i) => ({ ...i, url: urls[i.storage_path] ?? null }))} />
      </div>
    </div>
  );
}
