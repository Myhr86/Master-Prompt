-- =============================================================================
-- Migrasjon 2: Supabase Storage – privat bøtte for bilder
-- Filer leses via kortlevde signerte URL-er generert på serveren.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media_owner_select" on storage.objects;
create policy "media_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.is_owner());

drop policy if exists "media_owner_insert" on storage.objects;
create policy "media_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_owner());

drop policy if exists "media_owner_update" on storage.objects;
create policy "media_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_owner())
  with check (bucket_id = 'media' and public.is_owner());

drop policy if exists "media_owner_delete" on storage.objects;
create policy "media_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_owner());
