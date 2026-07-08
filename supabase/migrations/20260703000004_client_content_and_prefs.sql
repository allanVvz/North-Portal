-- Rich per-client display content (CMS-like) + per-client portal preferences.
-- Mirrors the existing role/ownership RLS model (owns_client / is_admin).
--
-- client_content.data holds the "estático fiel ao Figma" sections as JSON so the
-- admin can override any client's Central/Entregas/Documentos/Time/Agenda/Dashboard
-- content; the front-end falls back to the shared defaults in app/[slug]/portalData.ts.
-- client_prefs holds the theme (claro/escuro), avatar style, display name and username
-- editable by the client in Configurações.

create table if not exists public.client_content (
  client_id uuid primary key references public.clients(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_prefs (
  client_id uuid primary key references public.clients(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light','dark')),
  avatar_style smallint not null default 0 check (avatar_style between 0 and 4),
  display_name text,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at triggers
drop trigger if exists set_updated_at on public.client_content;
create trigger set_updated_at before update on public.client_content
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.client_prefs;
create trigger set_updated_at before update on public.client_prefs
  for each row execute function public.set_updated_at();

-- RLS
alter table public.client_content enable row level security;
alter table public.client_prefs enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('client_content','client_prefs')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end$$;

-- content: client read-only own; admin full write
create policy "content read own" on public.client_content
  for select to authenticated using (public.owns_client(client_id));
create policy "content admin write" on public.client_content
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- prefs: client read + insert + update own; admin full
create policy "prefs read own" on public.client_prefs
  for select to authenticated using (public.owns_client(client_id));
create policy "prefs insert own" on public.client_prefs
  for insert to authenticated with check (public.owns_client(client_id));
create policy "prefs update own" on public.client_prefs
  for update to authenticated using (public.owns_client(client_id)) with check (public.owns_client(client_id));
create policy "prefs admin delete" on public.client_prefs
  for delete to authenticated using (public.is_admin());
