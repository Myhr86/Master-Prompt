-- =============================================================================
-- Migrasjon 8: Konkurranser
-- Konkurranser med faste vilkår, tilknyttede innlegg (kunngjøring, påminnelse,
-- vinner) og loggført trekning. Kun vinnerens navn og antall deltakere lagres.
-- =============================================================================
create table if not exists public.contests (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 200),
  prize            text not null check (char_length(prize) between 1 and 500),
  prize_product_id uuid references public.products (id) on delete set null,
  question         text check (question is null or char_length(question) <= 300),
  entry_method     text not null default 'kommentar' check (entry_method in ('kommentar', 'kommentar_like')),
  min_age          integer not null default 18 check (min_age between 13 and 99),
  region           text not null default 'Norge' check (char_length(region) <= 100),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  announce_at      timestamptz not null,
  winner_count     integer not null default 1 check (winner_count between 1 and 10),
  delivery_note    text check (delivery_note is null or char_length(delivery_note) <= 300),
  rules_text       text,
  status           text not null default 'utkast' check (status in ('utkast', 'aktiv', 'avsluttet', 'trukket', 'avlyst')),
  winners          text[] not null default '{}',
  entries_count    integer,
  drawn_at         timestamptz,
  draw_seed_hash   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contest_dates_valid check (starts_at < ends_at and ends_at <= announce_at)
);
create index if not exists contests_created_idx on public.contests (created_at desc);

alter table public.posts add column if not exists contest_id uuid references public.contests (id) on delete set null;
alter table public.posts add column if not exists contest_role text;
do $$ begin
  alter table public.posts add constraint posts_contest_role_check check (contest_role is null or contest_role in ('kunngjoring', 'paminnelse', 'vinner'));
exception when duplicate_object then null; end $$;
create index if not exists posts_contest_idx on public.posts (contest_id) where contest_id is not null;

drop trigger if exists contests_touch on public.contests;
create trigger contests_touch before update on public.contests for each row execute function public.touch_updated_at();

alter table public.contests enable row level security;
revoke all on public.contests from anon;
grant select, insert, update, delete on public.contests to authenticated;
drop policy if exists owner_all on public.contests;
create policy owner_all on public.contests for all to authenticated using (public.is_owner()) with check (public.is_owner());
