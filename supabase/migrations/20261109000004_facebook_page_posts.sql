-- =============================================================================
-- Migrasjon 4: Eksisterende innlegg fra Facebook-siden
-- Kopi av innlegg som allerede ligger på siden (også de som er publisert
-- direkte på Facebook), slik at AI-en kan unngå gjentakelser.
-- Skrives kun av serveren (service-rollen), leses av eier.
-- =============================================================================

create table if not exists public.facebook_page_posts (
  id                uuid primary key default gen_random_uuid(),
  page_id           text not null,
  facebook_post_id  text not null unique,
  message           text not null default '',
  created_time      timestamptz not null,
  permalink_url     text,
  has_image         boolean not null default false,
  status_type       text,
  imported_at       timestamptz not null default now()
);
create index if not exists facebook_page_posts_created_idx on public.facebook_page_posts (created_time desc);

alter table public.facebook_page_posts enable row level security;
revoke all on public.facebook_page_posts from anon, authenticated;
grant select on public.facebook_page_posts to authenticated;

drop policy if exists owner_read on public.facebook_page_posts;
create policy owner_read on public.facebook_page_posts
  for select to authenticated using (public.is_owner());
