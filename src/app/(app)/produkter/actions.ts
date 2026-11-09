"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { audit } from "@/lib/audit";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";
import { getSettings } from "@/lib/data";
import { assertAllowedUrl, diffProduct, importFromStore, importProductPage, isListingUrl, normalizeImageUrls, type ImportedProduct } from "@/lib/products/importer";
import { fetchImage } from "@/lib/products/image-fetch";
import { sanitizeUpload } from "@/lib/images/compose";
import { removeMedia, uploadMedia } from "@/lib/images/storage";
import { uuidSchema } from "@/lib/posts/validation";

const productSchema = z.object({
  name: z.string().trim().min(1, "Navn mangler").max(300),
  description: z.string().trim().max(10000),
  price: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(/\s/g, "").replace(",", "."))))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Ugyldig pris"),
  product_url: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^https:\/\//.test(v), "Lenken må starte med https://"),
  active: z.boolean(),
  needs_verification: z.boolean(),
  verification_note: z.string().trim().max(1000).transform((v) => (v === "" ? null : v)),
});

function readProduct(fd: FormData) {
  return productSchema.parse({
    name: fd.get("name") ?? "",
    description: fd.get("description") ?? "",
    price: String(fd.get("price") ?? ""),
    product_url: String(fd.get("product_url") ?? ""),
    active: fd.get("active") === "on",
    needs_verification: fd.get("needs_verification") === "on",
    verification_note: String(fd.get("verification_note") ?? ""),
  });
}

export async function saveProduct(_prev: ActionResult<{ id: string }> | undefined, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const owner = await requireOwner();
    const data = readProduct(fd);
    const id = String(fd.get("id") ?? "");
    const supabase = await createClient();
    if (id) {
      uuidSchema.parse(id);
      const { error } = await supabase.from("products").update(data).eq("id", id);
      if (error) throw error;
      await audit("product.updated", { actorId: owner.id, entity: "product", entityId: id });
      revalidatePath("/produkter", "layout");
      return { ok: true, message: "Produktet er lagret.", data: { id } };
    }
    const { data: row, error } = await supabase.from("products").insert({ ...data, source: "manual" }).select("id").single();
    if (error) throw error;
    await audit("product.created", { actorId: owner.id, entity: "product", entityId: row.id });
    revalidatePath("/produkter", "layout");
    return { ok: true, message: "Produktet er opprettet.", data: { id: row.id } };
  } catch (err) {
    return toActionError(err, "saveProduct");
  }
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { data: imgs } = await supabase.from("product_images").select("storage_path").eq("product_id", id);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    await removeMedia((imgs ?? []).map((i) => i.storage_path));
    await audit("product.deleted", { actorId: owner.id, entity: "product", entityId: id });
    revalidatePath("/produkter", "layout");
    return { ok: true, message: "Produktet er slettet." };
  } catch (err) {
    return toActionError(err, "deleteProduct");
  }
}

export async function uploadProductImage(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    const productId = uuidSchema.parse(fd.get("product_id"));
    const imageType = z.enum(["product_photo", "detail", "lifestyle", "cutout"]).parse(fd.get("image_type") ?? "product_photo");
    const alt = z.string().max(300).parse(String(fd.get("alt_text") ?? ""));
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new UserFacingError("Velg minst ett bilde.");
    if (files.length > 10) throw new UserFacingError("Maks 10 bilder om gangen.");
    await enforceRateLimit(`upload:${owner.id}`, 60, 3600);
    const supabase = await createClient();
    const { count } = await supabase.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId);
    let first = (count ?? 0) === 0;
    for (const file of files) {
      const clean = await sanitizeUpload(Buffer.from(await file.arrayBuffer()));
      const path = await uploadMedia(clean.data, clean.mimeType, "products");
      const { error } = await supabase.from("product_images").insert({ product_id: productId, storage_path: path, image_type: imageType, alt_text: alt || null, is_primary: first });
      if (error) {
        await removeMedia([path]);
        throw error;
      }
      first = false;
    }
    await audit("product.images_uploaded", { actorId: owner.id, entity: "product", entityId: productId, details: { count: files.length } });
    revalidatePath(`/produkter/${productId}`);
    return { ok: true, message: `${files.length} bilde(r) lastet opp.` };
  } catch (err) {
    if (err instanceof Error && /bilde|JPEG|15 MB|tom/i.test(err.message) && !(err instanceof UserFacingError)) return { ok: false, error: err.message };
    return toActionError(err, "uploadProductImage");
  }
}

export async function setPrimaryImage(productId: string, imageId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    uuidSchema.parse(productId);
    uuidSchema.parse(imageId);
    const supabase = await createClient();
    await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
    const { error } = await supabase.from("product_images").update({ is_primary: true }).eq("id", imageId).eq("product_id", productId);
    if (error) throw error;
    revalidatePath(`/produkter/${productId}`);
    return { ok: true, message: "Hovedbildet er endret." };
  } catch (err) {
    return toActionError(err, "setPrimaryImage");
  }
}

export async function deleteProductImage(productId: string, imageId: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(imageId);
    const supabase = await createClient();
    const { data } = await supabase.from("product_images").select("storage_path").eq("id", imageId).single();
    const { count } = await supabase.from("posts").select("id", { count: "exact", head: true }).eq("image_path", data?.storage_path ?? "").in("status", ["APPROVED", "SCHEDULED", "PUBLISHING"]);
    if (count) throw new UserFacingError("Bildet brukes i et godkjent eller planlagt innlegg og kan ikke slettes nå.");
    const { error } = await supabase.from("product_images").delete().eq("id", imageId);
    if (error) throw error;
    if (data) await removeMedia([data.storage_path]);
    await audit("product.image_deleted", { actorId: owner.id, entity: "product", entityId: productId });
    revalidatePath(`/produkter/${productId}`);
    return { ok: true, message: "Bildet er slettet." };
  } catch (err) {
    return toActionError(err, "deleteProductImage");
  }
}

/**
 * Leser offentlig produktinformasjon fra nettbutikken.
 * - Nye produkter legges inn som INAKTIVE og "må bekreftes".
 * - Endringer i eksisterende produkter blir FORSLAG som eieren må godta.
 */
async function applyImport(imported: ImportedProduct[], ownerId: string) {
  const supabase = await createClient();
  const { data: existing } = await supabase.from("products").select("id, name, description, price, product_url, external_id");
  let created = 0;
  let proposals = 0;
  for (const p of imported) {
    const match = (existing ?? []).find((e) => (e.external_id && e.external_id === p.externalId) || (e.product_url && e.product_url === p.url));
    if (!match) {
      const { error } = await supabase.from("products").insert({
        name: p.name.slice(0, 300),
        description: p.description.slice(0, 10000),
        price: p.price,
        product_url: p.url.startsWith("https://") ? p.url : null,
        external_id: p.externalId,
        source: "import",
        active: false,
        needs_verification: true,
        verification_note: "Importert fra nettbutikken – kontroller opplysningene og aktiver produktet.",
        last_synced_at: new Date().toISOString(),
        source_image_urls: p.imageUrls,
      });
      if (!error) created++;
      continue;
    }
    const changes = diffProduct({ name: match.name, description: match.description, price: match.price === null ? null : Number(match.price), product_url: match.product_url }, p);
    for (const c of changes) {
      // Erstatt et eventuelt eldre, ubehandlet forslag for samme felt.
      await supabase.from("product_change_proposals").delete().eq("product_id", match.id).eq("field", c.field).eq("status", "pending");
      const { error } = await supabase
        .from("product_change_proposals")
        .insert({ product_id: match.id, field: c.field, current_value: c.current, proposed_value: c.proposed, status: "pending" });
      if (!error) proposals++;
    }
    // Bilde-URL-ene er bare en kilde for nedlasting (ikke produktopplysninger) og oppdateres direkte.
    await supabase
      .from("products")
      .update({ last_synced_at: new Date().toISOString(), external_id: match.external_id ?? p.externalId, ...(p.imageUrls.length ? { source_image_urls: p.imageUrls } : {}) })
      .eq("id", match.id);
  }
  await audit("product.import", { actorId: ownerId, details: { created, proposals } });
  return { created, proposals };
}

export async function importAllFromStore(): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`import:${owner.id}`, 10, 3600);
    const settings = await getSettings();
    const res = await importFromStore(settings.website);
    const { created, proposals } = await applyImport(res.products, owner.id);
    revalidatePath("/produkter", "layout");
    return { ok: true, message: `Fant ${res.products.length} produkter (${res.platform}). ${created} nye lagt inn som inaktive til kontroll, ${proposals} endringsforslag.` };
  } catch (err) {
    if (err instanceof Error && !("code" in err)) return { ok: false, error: err.message };
    return toActionError(err, "importAllFromStore");
  }
}

export async function importOneFromUrl(url: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`import:${owner.id}`, 30, 3600);
    const settings = await getSettings();
    const target = z.string().trim().url("Skriv inn en hel adresse, f.eks. https://myhrtreogdesign.com/products/…").parse(url);
    assertAllowedUrl(target, settings.website);
    // Forside eller kolleksjon: hent hele produktlisten i stedet.
    if (isListingUrl(target)) {
      const res = await importFromStore(settings.website);
      const r = await applyImport(res.products, owner.id);
      revalidatePath("/produkter", "layout");
      return { ok: true, message: `Adressen var en oversiktsside, så hele produktlisten ble hentet: ${res.products.length} produkter, ${r.created} nye lagt inn til kontroll, ${r.proposals} endringsforslag.` };
    }
    const p = await importProductPage(target, settings.website);
    const { created, proposals } = await applyImport([p], owner.id);
    revalidatePath("/produkter", "layout");
    return { ok: true, message: created ? `«${p.name}» er lagt inn som inaktivt produkt til kontroll.` : proposals ? `Fant ${proposals} endring(er) – se forslagene.` : "Produktet er allerede oppdatert." };
  } catch (err) {
    if (err instanceof Error && !("code" in err) && !(err instanceof z.ZodError)) return { ok: false, error: err.message };
    return toActionError(err, "importOneFromUrl");
  }
}

export async function resolveProposal(id: string, accept: boolean): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { data: prop } = await supabase.from("product_change_proposals").select("*").eq("id", id).eq("status", "pending").single();
    if (!prop) throw new UserFacingError("Fant ikke forslaget.");
    if (accept) {
      const value = prop.field === "price" ? (prop.proposed_value === null ? null : Number(prop.proposed_value)) : prop.proposed_value;
      const { error } = await supabase.from("products").update({ [prop.field]: value }).eq("id", prop.product_id);
      if (error) throw error;
    }
    await supabase.from("product_change_proposals").update({ status: accept ? "accepted" : "rejected", resolved_at: new Date().toISOString(), resolved_by: owner.id }).eq("id", id);
    await audit(accept ? "product.change_accepted" : "product.change_rejected", { actorId: owner.id, entity: "product", entityId: prop.product_id, details: { field: prop.field } });
    revalidatePath("/produkter", "layout");
    return { ok: true, message: accept ? "Endringen er tatt i bruk." : "Forslaget er avvist." };
  } catch (err) {
    return toActionError(err, "resolveProposal");
  }
}

/**
 * Henter produktbildene fra nettbutikken for ett produkt. Bildene valideres,
 * kodes om (metadata fjernes) og lagres i den private bøtta. Allerede hentede
 * bilder hoppes over.
 */
async function fetchImagesForProduct(productId: string, website: string): Promise<{ added: number; failed: string[] }> {
  const supabase = await createClient();
  const { data: product, error } = await supabase.from("products").select("id, name, product_url, source_image_urls").eq("id", productId).single();
  if (error || !product) throw new UserFacingError("Fant ikke produktet.");
  let urls: string[] = product.source_image_urls ?? [];
  if (!urls.length && product.product_url) {
    try {
      const page = await importProductPage(product.product_url, website);
      urls = page.imageUrls;
      if (urls.length) await supabase.from("products").update({ source_image_urls: urls }).eq("id", productId);
    } catch (e) {
      throw new UserFacingError(`Kunne ikke lese produktsiden: ${(e as Error).message}`);
    }
  }
  urls = normalizeImageUrls(urls, website);
  if (!urls.length) throw new UserFacingError("Fant ingen bilder for dette produktet i nettbutikken.");

  const { data: existing } = await supabase.from("product_images").select("source_url").eq("product_id", productId);
  const have = new Set((existing ?? []).map((e) => e.source_url).filter(Boolean));
  let first = (existing ?? []).length === 0;
  let added = 0;
  const failed: string[] = [];
  for (const url of urls) {
    if (have.has(url)) continue;
    try {
      const clean = await sanitizeUpload(await fetchImage(url));
      const path = await uploadMedia(clean.data, clean.mimeType, "products");
      const { error: insErr } = await supabase
        .from("product_images")
        .insert({ product_id: productId, storage_path: path, image_type: "product_photo", alt_text: product.name, is_primary: first, source_url: url });
      if (insErr) {
        await removeMedia([path]);
        throw insErr;
      }
      first = false;
      added++;
    } catch (e) {
      failed.push(`${new URL(url).pathname.split("/").pop()}: ${(e as Error).message}`);
    }
  }
  return { added, failed };
}

export async function importProductImagesFromStore(productId: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(productId);
    await enforceRateLimit(`image-import:${owner.id}`, 30, 3600);
    const settings = await getSettings();
    const { added, failed } = await fetchImagesForProduct(productId, settings.website);
    await audit("product.images_imported", { actorId: owner.id, entity: "product", entityId: productId, details: { added, failed: failed.length } });
    revalidatePath(`/produkter/${productId}`);
    revalidatePath("/produkter");
    if (!added && failed.length) return { ok: false, error: `Ingen bilder kunne hentes. ${failed.slice(0, 3).join(" · ")}` };
    return { ok: true, message: added ? `${added} bilde(r) hentet fra nettbutikken.${failed.length ? ` ${failed.length} feilet.` : ""}` : "Alle bildene fra nettbutikken er allerede hentet." };
  } catch (err) {
    return toActionError(err, "importProductImagesFromStore");
  }
}

/** Henter bilder for inntil 8 produkter som ikke har bilder ennå (begrenset for å holde seg innenfor tidsgrensen). */
export async function importImagesForProductsWithoutImages(): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await enforceRateLimit(`image-import-bulk:${owner.id}`, 10, 3600);
    const settings = await getSettings();
    const supabase = await createClient();
    const [{ data: products }, { data: imgs }] = await Promise.all([
      supabase.from("products").select("id").order("name"),
      supabase.from("product_images").select("product_id"),
    ]);
    const withImages = new Set((imgs ?? []).map((i) => i.product_id));
    const todo = (products ?? []).filter((p) => !withImages.has(p.id));
    let added = 0;
    let done = 0;
    let failedProducts = 0;
    for (const p of todo.slice(0, 8)) {
      try {
        const r = await fetchImagesForProduct(p.id, settings.website);
        added += r.added;
        if (!r.added) failedProducts++;
      } catch {
        failedProducts++;
      }
      done++;
    }
    await audit("product.images_imported_bulk", { actorId: owner.id, details: { products: done, added } });
    revalidatePath("/produkter", "layout");
    if (!todo.length) return { ok: true, message: "Alle produkter har allerede bilder." };
    const rest = todo.length - done;
    return {
      ok: true,
      message: `Hentet ${added} bilde(r) for ${done - failedProducts} av ${done} produkter.${failedProducts ? ` ${failedProducts} produkt(er) uten bilder i nettbutikken eller med feil.` : ""}${rest > 0 ? ` ${rest} gjenstår – trykk igjen for å fortsette.` : ""}`,
    };
  } catch (err) {
    return toActionError(err, "importImagesForProductsWithoutImages");
  }
}
