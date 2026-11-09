-- =============================================================================
-- Migrasjon 6: Sporing av trafikk til nettbutikken (UTM-parametere)
-- =============================================================================
alter table public.business_settings
  add column if not exists utm_enabled boolean not null default true,
  add column if not exists utm_source text not null default 'facebook',
  add column if not exists utm_medium text not null default 'social';

do $$ begin
  alter table public.business_settings add constraint utm_values_valid
    check (utm_source ~ '^[a-z0-9_-]{1,40}$' and utm_medium ~ '^[a-z0-9_-]{1,40}$');
exception when duplicate_object then null; end $$;
