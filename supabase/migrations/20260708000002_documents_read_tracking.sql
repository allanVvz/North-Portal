-- Real "read" tracking for client documents so Jornada can reflect an actual
-- "leu os documentos" state instead of a static, unlinked pendency item.
alter table public.documents add column if not exists read_at timestamptz;

-- Clients had read-only access to their own documents; they now also need to
-- mark them read (same trust model as "prefs update own" — the API layer
-- only ever writes read_at, RLS just scopes the row to the owning client).
create policy "documents client mark read" on public.documents
  for update to authenticated using (public.owns_client(client_id)) with check (public.owns_client(client_id));
