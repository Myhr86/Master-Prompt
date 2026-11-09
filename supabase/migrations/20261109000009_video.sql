-- =============================================================================
-- Migrasjon 9: Video i mediebanken og publisering som Reels/video
-- =============================================================================
alter table public.media_assets
  add column if not exists media_type text not null default 'image',
  add column if not exists mime_type text,
  add column if not exists duration_seconds numeric(8, 2),
  add column if not exists thumbnail_path text;

do $$ begin
  alter table public.media_assets add constraint media_assets_media_type_check check (media_type in ('image', 'video'));
exception when duplicate_object then null; end $$;

-- Bøtta tillater nå også video. 50 MB per fil passer Supabase sin gratisplan;
-- på betalt plan kan grensen økes i Storage-innstillingene.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
       file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
 where id = 'media';
