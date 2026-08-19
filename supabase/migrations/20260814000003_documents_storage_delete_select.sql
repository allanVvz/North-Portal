-- Storage object deletion first resolves the object under RLS. A SELECT policy
-- is therefore required in addition to DELETE, even though public object URLs
-- are readable through the public-bucket delivery endpoint.

drop policy if exists "documents storage admin select" on storage.objects;
create policy "documents storage admin select" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.is_admin());
