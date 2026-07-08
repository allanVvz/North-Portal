-- Access levels within each role: admin accounts are 'editor' or 'gerente';
-- client accounts (multiple per client_id are now expected — a client can
-- have several logins) are 'usuario' or 'gerente'. 'gerente' means elevated
-- permission within that group (an admin gerente can approve/set metrics an
-- editor can't; a client gerente can approve cards assigned to that
-- client's own 'usuario' accounts, not just their own).
alter table public.profiles add column if not exists level text;
alter table public.profiles drop constraint if exists profiles_level_check;
alter table public.profiles add constraint profiles_level_check check (
  level is null
  or (role = 'admin' and level in ('editor', 'gerente'))
  or (role = 'client' and level in ('usuario', 'gerente'))
);

-- Backfill: the two existing accounts both get full power for now (explicit
-- product decision — karpinski's one login is the client's manager until
-- more accounts exist).
update public.profiles set level = 'gerente' where level is null;
alter table public.profiles alter column level set not null;

-- New signups need a level too — defaults to the base level per role unless
-- app_metadata.level is set explicitly (create-user.mjs can pass it).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role public.user_role;
  meta_client uuid;
  meta_level text;
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
  meta_level := new.raw_app_meta_data ->> 'level';
  if meta_level is null then
    meta_level := case when meta_role = 'admin' then 'editor' else 'usuario' end;
  end if;

  insert into public.profiles (id, role, client_id, full_name, level)
  values (
    new.id,
    meta_role,
    meta_client,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    meta_level
  )
  on conflict (id) do update
    set role = excluded.role,
        client_id = excluded.client_id,
        level = excluded.level;
  return new;
end;
$$;

-- Shared helper: is the current session a 'gerente' (either role)?
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select level = 'gerente' from public.profiles where id = auth.uid()), false)
$$;

-- A client 'gerente' can also approve cards assigned to that client's own
-- 'usuario' reviewers, not just cards assigned to themselves.
drop policy if exists "tasks client approve own" on public.tasks;
create policy "tasks client approve own" on public.tasks
  for update to authenticated
  using (
    client_id = public.current_client_id()
    and status = 'aprovacao'
    and (reviewer_id = auth.uid() or public.is_manager())
  )
  with check (
    client_id = public.current_client_id()
  );
