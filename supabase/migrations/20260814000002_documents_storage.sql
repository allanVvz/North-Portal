-- Real file uploads for client documents.
-- Objects are public to preserve the existing URL-based download/share flow,
-- but only authenticated admins may create, replace or remove them.

alter table public.documents
  add column if not exists storage_path text,
  add column if not exists original_file_name text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint;

alter table public.documents
  drop constraint if exists documents_size_bytes_check;
alter table public.documents
  add constraint documents_size_bytes_check
  check (size_bytes is null or (size_bytes >= 0 and size_bytes <= 52428800));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', true, 52428800, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents storage admin insert" on storage.objects;
drop policy if exists "documents storage admin update" on storage.objects;
drop policy if exists "documents storage admin delete" on storage.objects;

create policy "documents storage admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.is_admin());

create policy "documents storage admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and public.is_admin())
  with check (bucket_id = 'documents' and public.is_admin());

create policy "documents storage admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());
