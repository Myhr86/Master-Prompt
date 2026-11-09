-- =============================================================================
-- Migrasjon 3: Henting av produktbilder fra nettbutikken
-- Lagrer bilde-URL-ene fra nettbutikken og hvor hvert produktbilde kom fra,
-- slik at samme bilde ikke hentes to ganger.
-- =============================================================================

alter table public.products
  add column if not exists source_image_urls text[] not null default '{}';

alter table public.product_images
  add column if not exists source_url text;

create unique index if not exists product_images_source_unique
  on public.product_images (product_id, source_url)
  where source_url is not null;
