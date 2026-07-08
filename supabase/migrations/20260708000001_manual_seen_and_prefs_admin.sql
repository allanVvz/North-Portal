-- Manual do Cliente completion becomes real, server-tracked state instead of
-- a client-side-only localStorage flag — needed so Jornada/Home reflect the
-- real status and so Onboarding (admin) can show it per client.
alter table public.client_prefs add column if not exists manual_seen boolean not null default false;

-- client_prefs had no admin-read policy at all (only "prefs admin delete") —
-- an oversight from the original migration. Admin needs to read manual_seen
-- (and prefs generally) across clients for the Onboarding screen, matching
-- the admin-full-access pattern already used on every other client table.
drop policy if exists "prefs admin delete" on public.client_prefs;
create policy "prefs admin full" on public.client_prefs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
