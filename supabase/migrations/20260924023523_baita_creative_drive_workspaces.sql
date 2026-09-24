-- Workspaces de Google Drive por diaria e por Criativo.
-- Piloto: Plano de Acao BAITA 7e1a162d-ff0f-414e-ad50-bea8b472fbcd.
-- A migration e aditiva: nao move nem remove itens legados do Drive.

begin;

alter table public.client_drive_links
  add column if not exists raw_folder_id text,
  add column if not exists raw_url text;

-- O link legado de uploads da BAITA foi verificado como a pasta EDIÇÃO.
-- Preenche somente o id canonico que ja corresponde ao URL existente.
update public.client_drive_links
set uploads_folder_id = '10yfhwlbsCrBsINQWqMvmYmrfm-eYe3qZ'
where client_id = '4f2bfda6-325d-4da3-94ff-c64802e1e2a4'
  and uploads_folder_id is null
  and uploads_url like '%10yfhwlbsCrBsINQWqMvmYmrfm-eYe3qZ%';

create table if not exists public.drive_workspace_plan_allowlist (
  plan_task_id uuid primary key,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.drive_workspace_plan_allowlist (plan_task_id, enabled)
values ('7e1a162d-ff0f-414e-ad50-bea8b472fbcd', true)
on conflict (plan_task_id) do update set enabled = excluded.enabled, updated_at = now();

create table if not exists public.drive_capture_workspaces (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  routine_task_id uuid references public.tasks(id) on delete restrict,
  plan_task_id uuid not null references public.tasks(id) on delete restrict,
  capture_task_id uuid not null references public.tasks(id) on delete restrict,
  capture_date date,
  daily_folder_id text,
  script_folder_id text,
  capture_folder_id text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'error', 'disabled')),
  last_error text,
  provision_attempts integer not null default 0 check (provision_attempts >= 0),
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_task_id, capture_task_id)
);

create table if not exists public.drive_creative_workspaces (
  id uuid primary key default gen_random_uuid(),
  capture_workspace_id uuid not null references public.drive_capture_workspaces(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  routine_task_id uuid references public.tasks(id) on delete restrict,
  plan_task_id uuid not null references public.tasks(id) on delete restrict,
  capture_task_id uuid not null references public.tasks(id) on delete restrict,
  creative_task_id uuid not null references public.tasks(id) on delete restrict,
  stage_task_id uuid references public.tasks(id) on delete set null,
  creative_folder_id text,
  preview_folder_id text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'error', 'disabled')),
  last_error text,
  provision_attempts integer not null default 0 check (provision_attempts >= 0),
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creative_task_id),
  unique (plan_task_id, creative_task_id)
);

create table if not exists public.drive_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.drive_creative_workspaces(id) on delete cascade,
  drive_file_id text not null,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  role text not null check (role in ('raw', 'preview', 'final')),
  state text not null default 'active' check (state in ('uploading', 'active', 'trashed', 'error')),
  web_view_link text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  upload_session_expires_at timestamptz,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, drive_file_id)
);

create table if not exists public.drive_raw_asset_links (
  workspace_id uuid not null references public.drive_creative_workspaces(id) on delete cascade,
  asset_id uuid not null references public.drive_assets(id) on delete cascade,
  shortcut_drive_file_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, asset_id)
);

create table if not exists public.drive_final_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.drive_creative_workspaces(id) on delete cascade,
  asset_id uuid not null references public.drive_assets(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  state text not null default 'current' check (state in ('current', 'superseded', 'trashed')),
  promoted_by uuid references public.profiles(id) on delete set null,
  restored_from_id uuid references public.drive_final_versions(id) on delete set null,
  promoted_at timestamptz not null default now(),
  trashed_at timestamptz,
  unique (workspace_id, version_number),
  unique (workspace_id, asset_id)
);

create index if not exists drive_capture_workspaces_capture_idx
  on public.drive_capture_workspaces (capture_task_id);
create index if not exists drive_creative_workspaces_plan_idx
  on public.drive_creative_workspaces (plan_task_id, status);
create index if not exists drive_assets_workspace_role_idx
  on public.drive_assets (workspace_id, role, state, created_at desc);
create index if not exists drive_final_versions_workspace_idx
  on public.drive_final_versions (workspace_id, state, version_number desc);

drop trigger if exists set_updated_at on public.drive_workspace_plan_allowlist;
create trigger set_updated_at before update on public.drive_workspace_plan_allowlist
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.drive_capture_workspaces;
create trigger set_updated_at before update on public.drive_capture_workspaces
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.drive_creative_workspaces;
create trigger set_updated_at before update on public.drive_creative_workspaces
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.drive_assets;
create trigger set_updated_at before update on public.drive_assets
  for each row execute function public.set_updated_at();

alter table public.drive_workspace_plan_allowlist enable row level security;
alter table public.drive_capture_workspaces enable row level security;
alter table public.drive_creative_workspaces enable row level security;
alter table public.drive_assets enable row level security;
alter table public.drive_raw_asset_links enable row level security;
alter table public.drive_final_versions enable row level security;

create policy "drive workspace allowlist admin" on public.drive_workspace_plan_allowlist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "drive capture workspaces admin" on public.drive_capture_workspaces
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "drive creative workspaces admin" on public.drive_creative_workspaces
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "drive assets admin" on public.drive_assets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "drive raw links admin" on public.drive_raw_asset_links
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "drive final versions admin" on public.drive_final_versions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- O cliente le somente materiais do proprio cliente e de Criativos visiveis.
-- A pasta EDIÇÃO inteira nunca e exposta por estas policies.
create policy "drive creative workspaces client read" on public.drive_creative_workspaces
  for select to authenticated using (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.tasks t
      where t.id = drive_creative_workspaces.creative_task_id
        and t.client_id = public.current_client_id()
        and (t.client_visible or t.status in ('aprovacao', 'aprovado'))
    )
  );
create policy "drive assets client read" on public.drive_assets
  for select to authenticated using (
    state = 'active' and role in ('preview', 'final')
    and exists (
      select 1 from public.drive_creative_workspaces w
      join public.tasks t on t.id = w.creative_task_id
      where w.id = drive_assets.workspace_id
        and w.client_id = public.current_client_id()
        and t.client_id = public.current_client_id()
        and (t.client_visible or t.status in ('aprovacao', 'aprovado'))
    )
  );
create policy "drive final versions client read" on public.drive_final_versions
  for select to authenticated using (
    state <> 'trashed' and exists (
      select 1 from public.drive_creative_workspaces w
      join public.tasks t on t.id = w.creative_task_id
      where w.id = drive_final_versions.workspace_id
        and w.client_id = public.current_client_id()
        and t.client_id = public.current_client_id()
        and (t.client_visible or t.status in ('aprovacao', 'aprovado'))
    )
  );

grant select, insert, update, delete on public.drive_workspace_plan_allowlist to authenticated;
grant select, insert, update, delete on public.drive_capture_workspaces to authenticated;
grant select, insert, update, delete on public.drive_creative_workspaces to authenticated;
grant select, insert, update, delete on public.drive_assets to authenticated;
grant select, insert, update, delete on public.drive_raw_asset_links to authenticated;
grant select, insert, update, delete on public.drive_final_versions to authenticated;

-- Comentarios podem referenciar assets sem agregar o thread ao Plano ou a
-- etapa compartilhada. A RPC grava sempre na tarefa criativa recebida.
create or replace function public.append_task_comment_with_assets(
  p_task_id uuid,
  p_author_id uuid,
  p_text text,
  p_comment_id text default null,
  p_asset_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  author_name text;
  updated public.tasks;
  existing public.tasks;
begin
  if nullif(btrim(p_text), '') is null or length(p_text) > 2000 then
    raise exception 'Comentario invalido';
  end if;
  if p_comment_id is not null and (length(p_comment_id) < 8 or length(p_comment_id) > 64) then
    raise exception 'Identificador de comentario invalido';
  end if;
  if cardinality(coalesce(p_asset_ids, '{}'::uuid[])) > 20 then
    raise exception 'Muitos assets no comentario';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_asset_ids, '{}'::uuid[])) asset_id
    where not exists (
      select 1 from public.drive_assets a
      join public.drive_creative_workspaces w on w.id = a.workspace_id
      where a.id = asset_id and w.creative_task_id = p_task_id and a.state = 'active'
    )
  ) then
    raise exception 'Asset nao pertence ao Criativo';
  end if;

  select coalesce(nullif(full_name, ''), 'Admin') into author_name
  from public.profiles where id = p_author_id;

  update public.tasks t set
    payload = jsonb_set(
      coalesce(t.payload, '{}'::jsonb),
      '{comments}',
      coalesce(t.payload->'comments', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(
        jsonb_build_object(
          'id', p_comment_id,
          'author', coalesce(author_name, 'Admin'),
          'author_id', p_author_id,
          'text', btrim(p_text),
          'asset_ids', to_jsonb(coalesce(p_asset_ids, '{}'::uuid[])),
          'at', now()
        )
      )),
      true
    ),
    updated_at = now()
  where t.id = p_task_id
    and jsonb_array_length(coalesce(t.payload->'comments', '[]'::jsonb)) < 200
    and (
      p_comment_id is null
      or not (coalesce(t.payload->'comments', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', p_comment_id)))
    )
  returning t.* into updated;

  if updated.id is not null then
    return jsonb_build_object('inserted', true, 'task', to_jsonb(updated));
  end if;
  select * into existing from public.tasks where id = p_task_id;
  if existing.id is not null and p_comment_id is not null
     and coalesce(existing.payload->'comments', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', p_comment_id)) then
    return jsonb_build_object('inserted', false, 'task', to_jsonb(existing));
  end if;
  return null;
end
$$;

revoke all on function public.append_task_comment_with_assets(uuid, uuid, text, text, uuid[]) from public, anon;
grant execute on function public.append_task_comment_with_assets(uuid, uuid, text, text, uuid[]) to authenticated;

commit;
