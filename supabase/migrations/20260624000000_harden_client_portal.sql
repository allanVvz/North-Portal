alter table public.clients enable row level security;
alter table public.briefing_answers enable row level security;
alter table public.client_drive_links enable row level security;
alter table public.client_results enable row level security;

create unique index if not exists clients_slug_unique_idx on public.clients (slug);
create unique index if not exists briefing_answers_client_id_unique_idx on public.briefing_answers (client_id);
create unique index if not exists client_drive_links_client_id_unique_idx on public.client_drive_links (client_id);
create unique index if not exists client_results_client_id_unique_idx on public.client_results (client_id);

drop policy if exists "public read active clients" on public.clients;
drop policy if exists "public read briefing for active clients" on public.briefing_answers;
drop policy if exists "public read links for active clients" on public.client_drive_links;
drop policy if exists "public read results for active clients" on public.client_results;
drop policy if exists "public update briefing" on public.briefing_answers;
drop policy if exists "allow all" on public.clients;
drop policy if exists "allow all" on public.briefing_answers;
drop policy if exists "allow all" on public.client_drive_links;
drop policy if exists "allow all" on public.client_results;
drop policy if exists "clients_public_insert" on public.clients;
drop policy if exists "clients_public_read" on public.clients;
drop policy if exists "clients_public_update" on public.clients;
drop policy if exists "briefing_public_insert" on public.briefing_answers;
drop policy if exists "briefing_public_read" on public.briefing_answers;
drop policy if exists "briefing_public_update" on public.briefing_answers;
drop policy if exists "drive_links_public_insert" on public.client_drive_links;
drop policy if exists "drive_links_public_read" on public.client_drive_links;
drop policy if exists "drive_links_public_update" on public.client_drive_links;
drop policy if exists "results_public_insert" on public.client_results;
drop policy if exists "results_public_read" on public.client_results;
drop policy if exists "results_public_update" on public.client_results;

create policy "public read active clients"
on public.clients for select
to anon, authenticated
using (is_active = true);

create policy "public read briefing for active clients"
on public.briefing_answers for select
to anon, authenticated
using (exists (
  select 1 from public.clients
  where clients.id = briefing_answers.client_id and clients.is_active = true
));

create policy "public read links for active clients"
on public.client_drive_links for select
to anon, authenticated
using (exists (
  select 1 from public.clients
  where clients.id = client_drive_links.client_id and clients.is_active = true
));

create policy "public read results for active clients"
on public.client_results for select
to anon, authenticated
using (exists (
  select 1 from public.clients
  where clients.id = client_results.client_id and clients.is_active = true
));
