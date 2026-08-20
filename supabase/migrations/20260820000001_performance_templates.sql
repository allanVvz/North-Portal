create table if not exists public.performance_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text not null default '' check (char_length(description) <= 240),
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  scope text not null check (scope in ('personal', 'agency')),
  config jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1 check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'personal' and owner_profile_id is not null) or (scope = 'agency' and owner_profile_id is null))
);

create unique index if not exists performance_templates_personal_name_idx
  on public.performance_templates (owner_profile_id, lower(btrim(name))) where scope = 'personal';
create unique index if not exists performance_templates_agency_name_idx
  on public.performance_templates (lower(btrim(name))) where scope = 'agency';
create index if not exists performance_templates_owner_idx
  on public.performance_templates (owner_profile_id, updated_at desc);

drop trigger if exists set_updated_at on public.performance_templates;
create trigger set_updated_at before update on public.performance_templates
  for each row execute function public.set_updated_at();

alter table public.performance_templates enable row level security;

create policy "performance templates read" on public.performance_templates for select to authenticated
  using (public.is_admin() and (scope = 'agency' or owner_profile_id = auth.uid()));
create policy "performance templates create" on public.performance_templates for insert to authenticated
  with check (public.is_admin() and ((scope = 'personal' and owner_profile_id = auth.uid()) or (scope = 'agency' and owner_profile_id is null and public.is_manager())));
create policy "performance templates update" on public.performance_templates for update to authenticated
  using (public.is_admin() and ((scope = 'personal' and owner_profile_id = auth.uid()) or (scope = 'agency' and public.is_manager())))
  with check (public.is_admin() and ((scope = 'personal' and owner_profile_id = auth.uid()) or (scope = 'agency' and owner_profile_id is null and public.is_manager())));
create policy "performance templates delete" on public.performance_templates for delete to authenticated
  using (public.is_admin() and ((scope = 'personal' and owner_profile_id = auth.uid()) or (scope = 'agency' and public.is_manager())));

