-- Auth foundation: profiles table linking Supabase Auth users to a role and,
-- for clients, to their clients row. Plus generic updated_at triggers.

-- role enum -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'client');
  end if;
end$$;

-- profiles: 1:1 with auth.users -----------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_client_id_idx on public.profiles (client_id);

-- updated_at trigger function -------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','briefing_answers','client_drive_links','client_results','profiles'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end$$;

-- create a profile automatically when an auth user is created -----------------
-- role/client_id are read from the user's app_metadata set at creation time:
--   { "role": "admin" }  OR  { "role": "client", "client_id": "<uuid>" }
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role public.user_role;
  meta_client uuid;
begin
  begin
    meta_role := coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'client');
  exception when others then
    meta_role := 'client';
  end;
  begin
    meta_client := nullif(new.raw_app_meta_data ->> 'client_id', '')::uuid;
  exception when others then
    meta_client := null;
  end;

  insert into public.profiles (id, role, client_id, full_name)
  values (
    new.id,
    meta_role,
    meta_client,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do update
    set role = excluded.role,
        client_id = excluded.client_id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
