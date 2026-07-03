-- RLS rewired to Supabase Auth: role + ownership based.
-- Replaces the anon "public read active clients" policies from the hardening migration.
-- Clients see only their own rows; admins see/manage everything.

-- helper functions (security definer → bypass profiles RLS, no recursion) ------
create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.current_client_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select client_id from public.profiles where id = auth.uid() $$;

create or replace function public.owns_client(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_admin() or (cid is not null and cid = public.current_client_id()) $$;

-- enable RLS ------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.briefing_answers enable row level security;
alter table public.client_drive_links enable row level security;
alter table public.client_results enable row level security;

-- drop legacy / previous policies --------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','clients','briefing_answers','client_drive_links','client_results')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end$$;

-- profiles --------------------------------------------------------------------
create policy "profiles self read" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles admin write" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- clients ---------------------------------------------------------------------
create policy "clients read own or admin" on public.clients
  for select to authenticated using (public.is_admin() or id = public.current_client_id());
create policy "clients admin insert" on public.clients
  for insert to authenticated with check (public.is_admin());
create policy "clients admin update" on public.clients
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "clients admin delete" on public.clients
  for delete to authenticated using (public.is_admin());

-- briefing_answers: client may read + update own; admin full -------------------
create policy "briefing read own" on public.briefing_answers
  for select to authenticated using (public.owns_client(client_id));
create policy "briefing update own" on public.briefing_answers
  for update to authenticated using (public.owns_client(client_id)) with check (public.owns_client(client_id));
create policy "briefing admin insert" on public.briefing_answers
  for insert to authenticated with check (public.is_admin());
create policy "briefing admin delete" on public.briefing_answers
  for delete to authenticated using (public.is_admin());

-- client_drive_links: client read-only; admin full ---------------------------
create policy "links read own" on public.client_drive_links
  for select to authenticated using (public.owns_client(client_id));
create policy "links admin write" on public.client_drive_links
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- client_results: client read-only; admin full -------------------------------
create policy "results read own" on public.client_results
  for select to authenticated using (public.owns_client(client_id));
create policy "results admin write" on public.client_results
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
