-- Registra arquivos encontrados diretamente na raiz/Preview de cada Criativo.
-- O lock no workspace serializa versoes quando dois modais sincronizam juntos.
begin;

create or replace function public.register_drive_folder_asset(
  p_workspace_id uuid,
  p_drive_file_id text,
  p_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_web_view_link text,
  p_role text,
  p_source_created_at timestamptz default null,
  p_promoted_by uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_asset public.drive_assets;
  v_version_id uuid;
  v_current_id uuid;
  v_timestamp timestamptz := coalesce(p_source_created_at, now());
begin
  if p_role not in ('preview', 'final') or nullif(btrim(p_drive_file_id), '') is null
     or nullif(btrim(p_name), '') is null then
    raise exception 'Arquivo do Drive invalido';
  end if;

  perform 1 from public.drive_creative_workspaces
  where id = p_workspace_id and status = 'ready'
  for update;
  if not found then raise exception 'Workspace do Criativo indisponivel'; end if;

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
    role = case when drive_assets.role = 'raw' then 'raw' else excluded.role end,
    state = case when drive_assets.role = 'raw' then drive_assets.state else 'active' end,
    trashed_at = case when drive_assets.role = 'raw' then drive_assets.trashed_at else null end
  returning * into v_asset;

  -- Um bruto classificado nunca vira final por engano se seu original mudar
  -- de pasta no Drive.
  if v_asset.role = 'raw' then return v_asset.id; end if;

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

  -- A posicao fisica no Drive decide quais versoes podem estar atuais.
  -- Versoes movidas de volta a Preview permanecem no historico.
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
$$;

revoke all on function public.register_drive_folder_asset(uuid,text,text,text,bigint,text,text,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.register_drive_folder_asset(uuid,text,text,text,bigint,text,text,timestamptz,uuid) to service_role;

commit;
