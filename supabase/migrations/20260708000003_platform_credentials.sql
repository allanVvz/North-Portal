-- Real credential storage for "Acessos & Pastas" — replaces the fully static
-- mock grants list (Meta Business/Instagram/Google Drive/Google Ads) with
-- actual client-submitted logins. Clients already authorized this in
-- contract; the platform just needs to persist what they type.
create table public.client_platform_credentials (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null,
  username text not null default '',
  password text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, platform)
);

alter table public.client_platform_credentials enable row level security;

create policy "credentials read own" on public.client_platform_credentials
  for select to authenticated using (public.owns_client(client_id));
create policy "credentials write own" on public.client_platform_credentials
  for insert to authenticated with check (public.owns_client(client_id));
create policy "credentials update own" on public.client_platform_credentials
  for update to authenticated using (public.owns_client(client_id)) with check (public.owns_client(client_id));
-- Agency needs the actual login to operate the client's accounts.
create policy "credentials admin full" on public.client_platform_credentials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
