-- =============================================================================
-- Migrasjon 10: Gjennomgang av Facebook-siden
-- Lagrer et øyeblikksbilde av sideinformasjonen (uten tokens) og Claudes
-- vurdering, slik at eieren kan følge forbedringene over tid.
-- =============================================================================
create table if not exists public.page_reviews (
  id          uuid primary key default gen_random_uuid(),
  snapshot    jsonb not null,
  result      jsonb not null,
  model       text,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists page_reviews_created_idx on public.page_reviews (created_at desc);

alter table public.page_reviews enable row level security;
revoke all on public.page_reviews from anon;
grant select, insert, update, delete on public.page_reviews to authenticated;
drop policy if exists owner_all on public.page_reviews;
create policy owner_all on public.page_reviews for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Coverbilde-format i bildeverkstedet
alter table public.media_assets drop constraint if exists media_assets_format_check;
alter table public.media_assets add constraint media_assets_format_check
  check (format is null or format in ('square', 'portrait', 'landscape', 'cover', 'original'));
