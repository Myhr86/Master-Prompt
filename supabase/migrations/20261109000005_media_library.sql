-- =============================================================================
-- Migrasjon 5: Mediebank
-- Egne bilder fra verkstedet, produksjon og produkter. Claude beskriver hvert
-- bilde én gang ved opplasting; beskrivelsene brukes når innlegg lages.
-- =============================================================================

alter table public.media_assets
  add column if not exists in_library boolean not null default false,
  add column if not exists description text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists category text,
  add column if not exists people_visible boolean,
  add column if not exists analysis_status text not null default 'none',
  add column if not exists analysis_error text,
  add column if not exists analyzed_at timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists use_count integer not null default 0;

do $$ begin
  alter table public.media_assets add constraint media_assets_analysis_status_check
    check (analysis_status in ('none', 'pending', 'done', 'failed'));
exception when duplicate_object then null; end $$;

create index if not exists media_assets_library_idx on public.media_assets (created_at desc) where in_library;
