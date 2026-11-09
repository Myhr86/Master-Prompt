-- =============================================================================
-- Myhr Tre og Design – AI Social Media Manager
-- Migrasjon 1: Skjema, sikkerhetsregler og Row Level Security
--
-- Prinsipp: de viktigste forretningsreglene (godkjenning, oppheving av
-- godkjenning ved endring, og beskyttelse mot dobbeltpublisering) håndheves
-- HER i databasen – ikke bare i applikasjonskoden. Selv om applikasjonen
-- skulle ha en feil, kan et innlegg ikke publiseres uten gyldig godkjenning.
-- =============================================================================

set check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- Typer
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.post_status as enum (
    'DRAFT',             -- Utkast
    'PENDING_APPROVAL',  -- Venter på godkjenning
    'APPROVED',          -- Godkjent (ikke planlagt)
    'SCHEDULED',         -- Godkjent og planlagt
    'PUBLISHING',        -- Publisering pågår (låst)
    'PUBLISHED',         -- Publisert og bekreftet av Facebook
    'REJECTED',          -- Avvist
    'FAILED'             -- Publisering feilet
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- users: autoriserte eiere. Rader opprettes KUN med service-rollen
-- (scripts/create-owner.mjs). Offentlig registrering skal være avslått.
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  role        text not null default 'owner' check (role in ('owner')),
  created_at  timestamptz not null default now()
);

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'owner'
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- business_settings: én rad (id = 1)
-- -----------------------------------------------------------------------------
create table if not exists public.business_settings (
  id                      smallint primary key default 1 check (id = 1),
  business_name           text not null default 'Myhr Tre og Design',
  website                 text not null default 'https://myhrtreogdesign.com/',
  language                text not null default 'nb-NO',
  brand_voice             text not null default
    'Varm, personlig og ekte. Vi er en norsk småbedrift som lager personlige produkter med omtanke og godt håndverk. Vi skriver enkelt og naturlig, uten overdrevent reklamespråk, og med få emojier.',
  posting_frequency       integer not null default 3 check (posting_frequency between 1 and 14),
  preferred_days          integer[] not null default '{1,3,5}',     -- ISO-ukedag 1=mandag … 7=søndag
  preferred_times         text[] not null default '{"19:00"}',      -- HH:MM, lokal tid
  timezone                text not null default 'Europe/Oslo',
  default_hashtags        text[] not null default '{"#myhrtreogdesign"}',
  prioritized_product_ids uuid[] not null default '{}',
  weekly_plan             jsonb not null default
    '[{"day":1,"theme":"Produktpresentasjon"},{"day":3,"theme":"Bak kulissene"},{"day":5,"theme":"Gaveinspirasjon"}]',
  seasonal_campaigns      jsonb not null default '[]',
  ai_model                text not null default 'claude-opus-5-5',
  image_provider          text not null default 'openai' check (image_provider in ('openai', 'none')),
  test_mode               boolean not null default true,  -- Simulert publisering er standard (trygt)
  updated_at              timestamptz not null default now(),
  constraint preferred_days_valid check (preferred_days <@ '{1,2,3,4,5,6,7}'::integer[]),
  constraint brand_voice_len check (char_length(brand_voice) <= 4000)
);

insert into public.business_settings (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- facebook_connections: token er kryptert (AES-256-GCM) i applikasjonen.
-- Ingen RLS-policyer for "authenticated" => kun service-rollen på serveren
-- kan lese tabellen. Status hentes via get_facebook_status().
-- -----------------------------------------------------------------------------
create table if not exists public.facebook_connections (
  id                      uuid primary key default gen_random_uuid(),
  page_id                 text not null,
  page_name               text not null,
  encrypted_access_token  text,
  token_expires_at        timestamptz,             -- null = ingen kjent utløpsdato
  connection_status       text not null default 'connected'
    check (connection_status in ('connected', 'expired', 'revoked', 'error', 'disconnected')),
  granted_scopes          text[] not null default '{}',
  connected_by            uuid references public.users (id) on delete set null,
  connected_at            timestamptz not null default now(),
  last_checked_at         timestamptz,
  last_error              text,
  updated_at              timestamptz not null default now(),
  constraint token_required_when_connected
    check (connection_status = 'disconnected' or encrypted_access_token is not null)
);

-- Kun én aktiv tilkobling om gangen
create unique index if not exists facebook_connections_one_active
  on public.facebook_connections ((true))
  where connection_status <> 'disconnected';

create or replace function public.get_facebook_status()
returns table (
  page_id text, page_name text, connection_status text, token_expires_at timestamptz,
  granted_scopes text[], connected_at timestamptz, last_checked_at timestamptz, last_error text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.page_id, c.page_name, c.connection_status, c.token_expires_at,
         c.granted_scopes, c.connected_at, c.last_checked_at, c.last_error
  from public.facebook_connections c
  where public.is_owner() and c.connection_status <> 'disconnected'
  order by c.connected_at desc
  limit 1;
$$;
revoke all on function public.get_facebook_status() from public;
grant execute on function public.get_facebook_status() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Produkter
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 300),
  description         text not null default '' check (char_length(description) <= 10000),
  price               numeric(10, 2) check (price is null or price >= 0),
  currency            text not null default 'NOK',
  product_url         text check (product_url is null or product_url ~* '^https://'),
  source              text not null default 'manual' check (source in ('manual', 'import')),
  external_id         text,
  active              boolean not null default true,
  needs_verification  boolean not null default false,   -- Opplysninger som må bekreftes av eier
  verification_note   text,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists products_external_id_key on public.products (external_id) where external_id is not null;
create index if not exists products_active_idx on public.products (active);

-- Endringer oppdaget i nettbutikken. Produktet endres ALDRI automatisk –
-- eieren må godta forslaget.
create table if not exists public.product_change_proposals (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  field           text not null check (field in ('name', 'description', 'price', 'product_url', 'active')),
  current_value   text,
  proposed_value  text,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  detected_at     timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.users (id) on delete set null
);
create index if not exists product_change_proposals_pending_idx
  on public.product_change_proposals (product_id) where status = 'pending';
create unique index if not exists product_change_proposals_unique_pending
  on public.product_change_proposals (product_id, field) where status = 'pending';

create table if not exists public.product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  storage_path  text not null unique,
  image_type    text not null default 'product_photo'
    check (image_type in ('product_photo', 'detail', 'lifestyle', 'cutout')),
  is_primary    boolean not null default false,
  alt_text      text,
  created_at    timestamptz not null default now()
);
create index if not exists product_images_product_idx on public.product_images (product_id);

-- Alle bildefiler i bildeverkstedet (opplastede, AI-genererte, komposisjoner)
create table if not exists public.media_assets (
  id               uuid primary key default gen_random_uuid(),
  storage_path     text not null unique,
  kind             text not null check (kind in ('upload', 'ai_generated', 'composite', 'text_graphic')),
  is_ai_generated  boolean not null default false,  -- Merkes tydelig i grensesnittet
  contains_real_product_photo boolean not null default false,
  prompt           text,
  provider         text,
  width            integer,
  height           integer,
  format           text check (format is null or format in ('square', 'portrait', 'landscape', 'original')),
  product_id       uuid references public.products (id) on delete set null,
  source_asset_id  uuid references public.media_assets (id) on delete set null,
  source_product_image_id uuid references public.product_images (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists media_assets_created_idx on public.media_assets (created_at desc);

-- -----------------------------------------------------------------------------
-- Innlegg
-- -----------------------------------------------------------------------------
create table if not exists public.posts (
  id                     uuid primary key default gen_random_uuid(),
  title                  text not null default '' check (char_length(title) <= 300),
  content                text not null default '' check (char_length(content) <= 10000),
  hashtags               text[] not null default '{}',
  link_url               text check (link_url is null or link_url ~* '^https://'),
  image_path             text,
  image_asset_id         uuid references public.media_assets (id) on delete set null,
  product_id             uuid references public.products (id) on delete set null,
  post_type              text,
  image_suggestion       text,
  rationale              text,
  quality                jsonb,
  variants               jsonb not null default '[]',
  verification_notes     text[] not null default '{}',
  scheduled_at           timestamptz,
  status                 public.post_status not null default 'DRAFT',
  approved_at            timestamptz,
  approved_by            uuid references public.users (id) on delete set null,
  approved_content_hash  text,
  published_at           timestamptz,
  facebook_post_id       text unique,
  facebook_post_url      text,
  publish_error          text,
  generated_by           text not null default 'owner' check (generated_by in ('ai', 'owner')),
  ai_model               text,
  generation_batch_id    uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint approval_fields_consistent check (
    (approved_at is null and approved_by is null and approved_content_hash is null)
    or (approved_at is not null and approved_by is not null and approved_content_hash is not null)
  ),
  constraint approved_states_need_approval check (
    status not in ('APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED') or approved_at is not null
  ),
  constraint scheduled_needs_time check (status <> 'SCHEDULED' or scheduled_at is not null),
  constraint published_needs_fb_id check (status <> 'PUBLISHED' or (facebook_post_id is not null and published_at is not null))
);
create index if not exists posts_status_idx on public.posts (status);
create index if not exists posts_scheduled_idx on public.posts (scheduled_at) where scheduled_at is not null;
create index if not exists posts_due_idx on public.posts (scheduled_at) where status = 'SCHEDULED';
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_product_idx on public.posts (product_id);

-- Kanonisk hash av alt som blir synlig på Facebook. MÅ holdes identisk med
-- src/lib/posts/content-hash.ts (testes i supabase/tests og tests/db).
create or replace function public.post_content_hash(
  p_title text, p_content text, p_hashtags text[], p_link_url text, p_image_path text
) returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(
    coalesce(p_title, '') || chr(31) ||
    coalesce(p_content, '') || chr(31) ||
    coalesce(array_to_string(p_hashtags, ' '), '') || chr(31) ||
    coalesce(p_link_url, '') || chr(31) ||
    coalesce(p_image_path, ''),
    'UTF8')), 'hex');
$$;

create table if not exists public.post_history (
  id                 uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.posts (id) on delete cascade,
  previous_content   text,
  new_content        text,
  previous_snapshot  jsonb,
  new_snapshot       jsonb,
  approval_revoked   boolean not null default false,
  changed_by         uuid,
  changed_at         timestamptz not null default now()
);
create index if not exists post_history_post_idx on public.post_history (post_id, changed_at desc);

create or replace function public.posts_record_history(
  p_post_id uuid, p_old jsonb, p_new jsonb, p_revoked boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Kalles fra posts-triggeren. Kun eier (eller service-rollen) kan skrive historikk.
  if not (public.is_owner() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Ikke autorisert' using errcode = '42501';
  end if;
  insert into public.post_history (post_id, previous_content, new_content, previous_snapshot, new_snapshot, approval_revoked, changed_by)
  values (p_post_id, p_old->>'content', p_new->>'content', p_old, p_new, p_revoked, auth.uid());
end;
$$;
revoke all on function public.posts_record_history(uuid, jsonb, jsonb, boolean) from public;

-- BEFORE INSERT: nye innlegg kan aldri starte som godkjent/publisert.
create or replace function public.posts_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.generated_by = 'ai' then
    new.status := 'PENDING_APPROVAL';   -- AI-innhold går ALLTID til godkjenning
  end if;
  if new.status not in ('DRAFT', 'PENDING_APPROVAL') then
    raise exception 'Nye innlegg må ha status DRAFT eller PENDING_APPROVAL' using errcode = 'P0001';
  end if;
  if new.approved_at is not null or new.approved_by is not null or new.approved_content_hash is not null
     or new.facebook_post_id is not null or new.published_at is not null then
    raise exception 'Nye innlegg kan ikke være forhåndsgodkjent eller publisert' using errcode = 'P0001';
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- BEFORE UPDATE: statusmaskin + oppheving av godkjenning.
create or replace function public.posts_before_update()
returns trigger
language plpgsql
as $$
declare
  old_hash text := public.post_content_hash(old.title, old.content, old.hashtags, old.link_url, old.image_path);
  new_hash text := public.post_content_hash(new.title, new.content, new.hashtags, new.link_url, new.image_path);
  content_changed boolean := old_hash is distinct from new_hash;
  revoked boolean := false;
begin
  -- Publiserte innlegg er låst.
  if old.status = 'PUBLISHED' then
    if content_changed or new.status <> old.status
       or new.facebook_post_id is distinct from old.facebook_post_id
       or new.approved_content_hash is distinct from old.approved_content_hash then
      raise exception 'Publiserte innlegg kan ikke endres' using errcode = 'P0001';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'PUBLISHING' and content_changed then
    raise exception 'Innholdet kan ikke endres mens publisering pågår' using errcode = 'P0001';
  end if;

  -- Facebook-felter kan kun settes ved overgang til PUBLISHED.
  if new.facebook_post_id is distinct from old.facebook_post_id and new.status <> 'PUBLISHED' then
    raise exception 'facebook_post_id kan kun settes ved publisering' using errcode = 'P0001';
  end if;

  if content_changed then
    if new.status is distinct from old.status and new.status in ('APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED') then
      raise exception 'Innhold kan ikke endres i samme operasjon som godkjenning/publisering' using errcode = 'P0001';
    end if;
    if old.approved_at is not null or old.status in ('APPROVED', 'SCHEDULED', 'FAILED') then
      -- KRAV: endring etter godkjenning opphever godkjenningen.
      new.status := 'PENDING_APPROVAL';
      new.approved_at := null;
      new.approved_by := null;
      new.approved_content_hash := null;
      revoked := true;
    end if;
    perform public.posts_record_history(
      old.id,
      jsonb_build_object('title', old.title, 'content', old.content, 'hashtags', old.hashtags,
                         'link_url', old.link_url, 'image_path', old.image_path),
      jsonb_build_object('title', new.title, 'content', new.content, 'hashtags', new.hashtags,
                         'link_url', new.link_url, 'image_path', new.image_path),
      revoked);
  end if;

  if new.status is distinct from old.status then
    case new.status
      when 'APPROVED' then
        if old.status not in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'SCHEDULED', 'FAILED') then
          raise exception 'Ugyldig statusovergang % -> APPROVED', old.status using errcode = 'P0001';
        end if;
        if old.status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') then
          -- Ny godkjenning: må gjøres av en registrert eier.
          if new.approved_by is null or not exists (select 1 from public.users u where u.id = new.approved_by and u.role = 'owner') then
            raise exception 'Godkjenning krever en autorisert eier' using errcode = 'P0001';
          end if;
          if auth.uid() is not null and new.approved_by <> auth.uid() then
            raise exception 'Du kan bare godkjenne i eget navn' using errcode = 'P0001';
          end if;
          new.approved_at := now();
          new.approved_content_hash := new_hash;
        else
          -- SCHEDULED/FAILED -> APPROVED (avplanlegging): behold eksisterende godkjenning
          if new.approved_content_hash is distinct from old.approved_content_hash
             or new.approved_by is distinct from old.approved_by then
            raise exception 'Godkjenningsfelter kan ikke endres direkte' using errcode = 'P0001';
          end if;
          if old.approved_content_hash is distinct from new_hash then
            raise exception 'Godkjenningen er ikke lenger gyldig' using errcode = 'P0001';
          end if;
        end if;

      when 'SCHEDULED' then
        if old.status not in ('APPROVED', 'FAILED') then
          raise exception 'Kun godkjente innlegg kan planlegges (% -> SCHEDULED)', old.status using errcode = 'P0001';
        end if;
        if old.approved_content_hash is distinct from new_hash then
          raise exception 'Godkjenningen er ikke lenger gyldig' using errcode = 'P0001';
        end if;

      when 'PUBLISHING' then
        if old.status not in ('APPROVED', 'SCHEDULED', 'FAILED') then
          raise exception 'Kun godkjente innlegg kan publiseres (% -> PUBLISHING)', old.status using errcode = 'P0001';
        end if;
        if old.approved_at is null or old.approved_content_hash is distinct from new_hash then
          raise exception 'Innlegget har ikke gyldig godkjenning' using errcode = 'P0001';
        end if;
        if old.facebook_post_id is not null then
          raise exception 'Innlegget er allerede publisert' using errcode = 'P0001';
        end if;

      when 'PUBLISHED' then
        if old.status <> 'PUBLISHING' then
          raise exception 'PUBLISHED kan kun settes fra PUBLISHING' using errcode = 'P0001';
        end if;
        if new.facebook_post_id is null then
          raise exception 'Publisering krever bekreftet Facebook-ID' using errcode = 'P0001';
        end if;
        if old.approved_content_hash is distinct from new_hash then
          raise exception 'Innlegget har ikke gyldig godkjenning' using errcode = 'P0001';
        end if;
        new.published_at := coalesce(new.published_at, now());

      when 'FAILED' then
        if old.status <> 'PUBLISHING' then
          raise exception 'FAILED kan kun settes fra PUBLISHING' using errcode = 'P0001';
        end if;

      when 'REJECTED', 'PENDING_APPROVAL', 'DRAFT' then
        if old.status = 'PUBLISHING' then
          raise exception 'Publisering pågår – vent til den er ferdig' using errcode = 'P0001';
        end if;
        new.approved_at := null;
        new.approved_by := null;
        new.approved_content_hash := null;
    end case;
  else
    -- Status uendret: godkjenningsfelter kan ikke manipuleres direkte
    if not revoked and (
         new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by
      or new.approved_content_hash is distinct from old.approved_content_hash) then
      raise exception 'Godkjenningsfelter kan ikke endres direkte' using errcode = 'P0001';
    end if;
  end if;

  new.created_at := old.created_at;
  new.generated_by := old.generated_by;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.posts_before_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('PUBLISHED', 'PUBLISHING') then
    raise exception 'Publiserte innlegg kan ikke slettes her' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert before insert on public.posts
  for each row execute function public.posts_before_insert();
drop trigger if exists posts_before_update on public.posts;
create trigger posts_before_update before update on public.posts
  for each row execute function public.posts_before_update();
drop trigger if exists posts_before_delete on public.posts;
create trigger posts_before_delete before delete on public.posts
  for each row execute function public.posts_before_delete();

-- -----------------------------------------------------------------------------
-- Publiseringsforsøk – idempotens og beskyttelse mot dobbeltpublisering
-- -----------------------------------------------------------------------------
create table if not exists public.publish_attempts (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  idempotency_key   text not null unique,
  state             text not null default 'in_progress'
    check (state in ('in_progress', 'succeeded', 'failed', 'unknown')),
  mode              text not null check (mode in ('live', 'simulated')),
  content_hash      text not null,
  page_id           text,
  facebook_post_id  text,
  error             text,
  started_by        uuid,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);
-- Maks ett aktivt/vellykket/uavklart EKTE forsøk per innlegg.
create unique index if not exists publish_attempts_one_active
  on public.publish_attempts (post_id)
  where mode = 'live' and state in ('in_progress', 'succeeded', 'unknown');
create index if not exists publish_attempts_post_idx on public.publish_attempts (post_id, started_at desc);

-- Atomisk "lås" av et innlegg for publisering. Feiler hvis innlegget ikke har
-- gyldig godkjenning, allerede er publisert, eller et annet forsøk pågår.
create or replace function public.claim_post_for_publishing(p_post_id uuid, p_mode text)
returns public.publish_attempts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_post public.posts;
  v_attempt public.publish_attempts;
  v_hash text;
begin
  select * into v_post from public.posts where id = p_post_id for update;
  if not found then
    raise exception 'Innlegget finnes ikke' using errcode = 'P0002';
  end if;
  if v_post.status not in ('APPROVED', 'SCHEDULED', 'FAILED') then
    raise exception 'Innlegget kan ikke publiseres med status %', v_post.status using errcode = 'P0001';
  end if;
  v_hash := public.post_content_hash(v_post.title, v_post.content, v_post.hashtags, v_post.link_url, v_post.image_path);
  if v_post.approved_at is null or v_post.approved_content_hash is distinct from v_hash then
    raise exception 'Innlegget har ikke gyldig godkjenning' using errcode = 'P0001';
  end if;
  if v_post.facebook_post_id is not null then
    raise exception 'Innlegget er allerede publisert' using errcode = 'P0001';
  end if;

  if p_mode = 'simulated' then
    -- Testmodus: alle kontroller over er utført, men ingenting sendes til
    -- Facebook og innleggets status endres ikke.
    insert into public.publish_attempts (post_id, idempotency_key, mode, content_hash, started_by)
    values (p_post_id, 'sim:' || gen_random_uuid()::text, 'simulated', v_hash, auth.uid())
    returning * into v_attempt;
    return v_attempt;
  end if;
  if p_mode <> 'live' then
    raise exception 'Ukjent publiseringsmodus' using errcode = 'P0001';
  end if;

  insert into public.publish_attempts (post_id, idempotency_key, mode, content_hash, started_by)
  values (p_post_id, p_post_id::text || ':' || v_hash, 'live', v_hash, auth.uid())
  on conflict do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    -- Samme innlegg + samme innhold er allerede forsøkt. Gjenbruk kun et
    -- avsluttet, feilet forsøk; ellers stopp.
    update public.publish_attempts
       set state = 'in_progress', error = null, started_at = now(), finished_at = null,
           started_by = auth.uid()
     where idempotency_key = p_post_id::text || ':' || v_hash and state = 'failed'
    returning * into v_attempt;
    if v_attempt.id is null then
      raise exception 'Et publiseringsforsøk pågår, er uavklart eller er allerede fullført' using errcode = 'P0001';
    end if;
  end if;

  update public.posts set status = 'PUBLISHING', publish_error = null where id = p_post_id;
  return v_attempt;
end;
$$;
revoke all on function public.claim_post_for_publishing(uuid, text) from public;
grant execute on function public.claim_post_for_publishing(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Analyse, AI-logg, revisjonslogg og rate limiting
-- -----------------------------------------------------------------------------
create table if not exists public.analytics (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  metric_name   text not null,
  metric_value  numeric not null,
  source        text not null default 'facebook',
  recorded_at   timestamptz not null default now()
);
create index if not exists analytics_post_metric_idx on public.analytics (post_id, metric_name, recorded_at desc);

create table if not exists public.ai_generations (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('posts', 'rewrite', 'analysis', 'image')),
  model         text not null,
  status        text not null check (status in ('succeeded', 'failed', 'refused')),
  request       jsonb,
  response      jsonb,
  usage         jsonb,
  error         text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists ai_generations_created_idx on public.ai_generations (created_at desc);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_type  text not null default 'owner' check (actor_type in ('owner', 'system', 'cron')),
  action      text not null,
  entity      text,
  entity_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

create table if not exists public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning count into v_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_count <= p_limit;
end;
$$;
revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to authenticated, service_role;

-- updated_at for øvrige tabeller
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.business_settings;
create trigger settings_touch before update on public.business_settings for each row execute function public.touch_updated_at();
drop trigger if exists fb_touch on public.facebook_connections;
create trigger fb_touch before update on public.facebook_connections for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.users                    enable row level security;
alter table public.business_settings        enable row level security;
alter table public.facebook_connections     enable row level security;
alter table public.products                 enable row level security;
alter table public.product_change_proposals enable row level security;
alter table public.product_images           enable row level security;
alter table public.media_assets             enable row level security;
alter table public.posts                    enable row level security;
alter table public.post_history             enable row level security;
alter table public.publish_attempts         enable row level security;
alter table public.analytics                enable row level security;
alter table public.ai_generations           enable row level security;
alter table public.audit_log                enable row level security;
alter table public.rate_limits              enable row level security;

-- Anonyme brukere har ingen tilgang til noe.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- Supabase gir som standard ALLE rettigheter til "authenticated". Vi tar dem
-- bort og gir kun det som trengs (minste privilegium), i tillegg til RLS.
revoke all on all tables in schema public from authenticated;
revoke execute on all functions in schema public from authenticated;
grant execute on function public.is_owner(), public.get_facebook_status(), public.claim_post_for_publishing(uuid, text),
  public.check_rate_limit(text, integer, integer), public.post_content_hash(text, text, text[], text, text),
  public.posts_record_history(uuid, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.posts_record_history(uuid, jsonb, jsonb, boolean) to service_role;

grant select on public.users to authenticated;
grant select, update on public.business_settings to authenticated;
grant select, insert, update, delete on public.products, public.product_images, public.media_assets, public.posts to authenticated;
grant select, insert, update, delete on public.product_change_proposals to authenticated;
grant select on public.post_history, public.publish_attempts to authenticated;
grant select, insert on public.analytics, public.ai_generations, public.audit_log to authenticated;
grant usage on all sequences in schema public to authenticated;
revoke all on public.facebook_connections from authenticated;
revoke all on public.rate_limits from authenticated;

drop policy if exists users_self on public.users;
create policy users_self on public.users for select to authenticated using (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['business_settings', 'products', 'product_images', 'media_assets', 'posts',
                           'product_change_proposals', 'analytics', 'ai_generations']
  loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

drop policy if exists owner_read on public.post_history;
create policy owner_read on public.post_history for select to authenticated using (public.is_owner());
drop policy if exists owner_read on public.publish_attempts;
create policy owner_read on public.publish_attempts for select to authenticated using (public.is_owner());
-- publish_attempts skrives via claim_post_for_publishing (invoker) og server-side service-rollen.
grant insert, update on public.publish_attempts to authenticated;
drop policy if exists owner_write on public.publish_attempts;
create policy owner_write on public.publish_attempts for insert to authenticated with check (public.is_owner());
drop policy if exists owner_update on public.publish_attempts;
create policy owner_update on public.publish_attempts for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Revisjonslogg: kun lese og legge til – aldri endre eller slette.
drop policy if exists owner_read on public.audit_log;
create policy owner_read on public.audit_log for select to authenticated using (public.is_owner());
drop policy if exists owner_insert on public.audit_log;
create policy owner_insert on public.audit_log for insert to authenticated with check (public.is_owner() and actor_id = auth.uid());

-- facebook_connections og rate_limits: ingen policyer => ingen tilgang for authenticated.
