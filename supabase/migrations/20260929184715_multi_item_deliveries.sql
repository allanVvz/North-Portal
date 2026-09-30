-- Entregas de VÁRIAS peças (30/09): carrossel e story.
--
-- Um carrossel (ou um card de story com vários stories) é salvo numa pasta
-- "Def", irmã de Raw e Preview:
--   📁 Entrega  ├ Raw  ├ Preview  └ Def   ← todas as peças da entrega
-- e TODAS as peças da Def fazem parte da entrega — nenhuma substitui outra.
-- Até aqui a automação só conhecia a entrega de um arquivo (vídeo): o final
-- ficava na raiz da pasta do criativo, e cada final novo virava a versão
-- atual e rebaixava os anteriores.
--
-- `final_folder_id`: a pasta das peças prontas (Def). Nulo = raiz da pasta do
-- criativo (entrega de um arquivo, como sempre foi).
-- `multi_final`: todas as peças ativas da Def são "atuais" ao mesmo tempo.
alter table public.drive_creative_workspaces
  add column if not exists final_folder_id text,
  add column if not exists multi_final boolean not null default false;

comment on column public.drive_creative_workspaces.final_folder_id is
  'Pasta das peças prontas (Def). Nulo = raiz da pasta do criativo.';
comment on column public.drive_creative_workspaces.multi_final is
  'Entrega de várias peças (carrossel, story): toda peça ativa é atual, nenhuma substitui outra.';

create or replace function public.register_drive_folder_asset(p_workspace_id uuid, p_drive_file_id text, p_name text, p_mime_type text, p_size_bytes bigint, p_web_view_link text, p_role text, p_source_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_promoted_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_asset public.drive_assets;
  v_version_id uuid;
  v_current_id uuid;
  v_timestamp timestamptz := coalesce(p_source_created_at, now());
  v_classified_source boolean;
  v_multi boolean;
begin
  if p_role not in ('preview', 'final') or nullif(btrim(p_drive_file_id), '') is null
     or nullif(btrim(p_name), '') is null then
    raise exception 'Arquivo do Drive invalido';
  end if;

  select multi_final into v_multi from public.drive_creative_workspaces
  where id = p_workspace_id and status = 'ready'
  for update;
  if not found then raise exception 'Workspace do Criativo indisponivel'; end if;

  select exists (
    select 1 from public.drive_assets a
    join public.drive_raw_asset_links l on l.workspace_id = a.workspace_id and l.asset_id = a.id
    where a.workspace_id = p_workspace_id and a.drive_file_id = p_drive_file_id
      and l.shortcut_drive_file_id is not null
  ) into v_classified_source;

  insert into public.drive_assets (
    workspace_id, drive_file_id, name, mime_type, size_bytes, role,
    state, web_view_link, created_at
  ) values (
    p_workspace_id, p_drive_file_id, p_name,
    coalesce(nullif(p_mime_type, ''), 'application/octet-stream'),
    p_size_bytes, p_role, 'active', p_web_view_link, v_timestamp
  )
  on conflict (workspace_id, drive_file_id) do update set
    name = excluded.name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    web_view_link = excluded.web_view_link,
    role = case when v_classified_source then 'raw' else excluded.role end,
    state = case when v_classified_source then drive_assets.state else 'active' end,
    trashed_at = case when v_classified_source then drive_assets.trashed_at else null end
  returning * into v_asset;

  if v_asset.role = 'raw' then return v_asset.id; end if;
  delete from public.drive_raw_asset_links
  where workspace_id = p_workspace_id and asset_id = v_asset.id and shortcut_drive_file_id is null;

  if p_role = 'final' then
    select id into v_version_id from public.drive_final_versions
    where workspace_id = p_workspace_id and asset_id = v_asset.id;
    if v_version_id is null then
      insert into public.drive_final_versions (
        workspace_id, asset_id, version_number, state, promoted_at, promoted_by
      ) values (
        p_workspace_id, v_asset.id,
        coalesce((select max(version_number) from public.drive_final_versions where workspace_id = p_workspace_id), 0) + 1,
        'superseded', v_timestamp, p_promoted_by
      ) returning id into v_version_id;
    else
      update public.drive_final_versions set state = 'superseded', trashed_at = null
      where id = v_version_id and state = 'trashed';
      if p_promoted_by is not null then
        update public.drive_final_versions
        set promoted_at = v_timestamp, promoted_by = p_promoted_by, state = 'superseded'
        where id = v_version_id;
      end if;
    end if;
  end if;

  -- Várias peças: toda peça final ativa é atual; nenhuma rebaixa outra.
  if coalesce(v_multi, false) then
    update public.drive_final_versions v set state = 'current'
    from public.drive_assets a
    where v.workspace_id = p_workspace_id and a.id = v.asset_id
      and v.state = 'superseded' and a.role = 'final' and a.state = 'active';
    return v_asset.id;
  end if;

  select v.id into v_current_id
  from public.drive_final_versions v
  join public.drive_assets a on a.id = v.asset_id
  where v.workspace_id = p_workspace_id
    and v.state <> 'trashed' and a.role = 'final' and a.state = 'active'
  order by v.promoted_at desc, v.version_number desc
  limit 1;

  update public.drive_final_versions set state = 'superseded'
  where workspace_id = p_workspace_id and state = 'current' and id is distinct from v_current_id;
  if v_current_id is not null then
    update public.drive_final_versions set state = 'current'
    where id = v_current_id and state <> 'current';
  end if;
  return v_asset.id;
end
$function$;
