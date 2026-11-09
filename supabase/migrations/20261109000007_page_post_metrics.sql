-- =============================================================================
-- Migrasjon 7: Engasjement og innleggstype for innlegg på Facebook-siden
-- Brukes til «beste tidspunkt» og «balanse i innholdet».
-- =============================================================================
alter table public.facebook_page_posts
  add column if not exists reactions integer,
  add column if not exists comments integer,
  add column if not exists shares integer,
  add column if not exists metrics_updated_at timestamptz,
  add column if not exists post_type text,
  add column if not exists classified_at timestamptz;
