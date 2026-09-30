-- Continuação de 20260930120000 (30/09): o registro de BRUTO também
-- recalculava a "versão atual única" no fim — e como a sincronização
-- registra os brutos depois das peças, desfazia o conjunto do carrossel
-- (voltava a "v3 atual, v1 e v2 anteriores"). Com multi_final, toda peça
-- final ativa segue atual.
CREATE OR REPLACE FUNCTION public.register_drive_raw_folder_asset(p_workspace_id uuid, p_drive_file_id text, p_name text, p_mime_type text, p_size_bytes bigint, p_web_view_link text, p_source_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_asset public.drive_assets;
  v_current_id uuid;
  v_multi boolean;
begin
  if nullif(btrim(p_drive_file_id), '') is null or nullif(btrim(p_name), '') is null then
    raise exception 'Arquivo do Drive invalido';
  end if;
  select multi_final into v_multi from public.drive_creative_workspaces
  where id = p_workspace_id and status = 'ready' and raw_folder_id is not null
  for update;
  if not found then raise exception 'Pasta Raw do Criativo indisponivel'; end if;

  insert into public.drive_assets (
    workspace_id, drive_file_id, name, mime_type, size_bytes, role,
    state, web_view_link, created_at
  ) values (
    p_workspace_id, p_drive_file_id, p_name,
    coalesce(nullif(p_mime_type, ''), 'application/octet-stream'),
    p_size_bytes, 'raw', 'active', p_web_view_link, coalesce(p_source_created_at, now())
  )
  on conflict (workspace_id, drive_file_id) do update set
    name = excluded.name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    web_view_link = excluded.web_view_link,
    role = 'raw', state = 'active', trashed_at = null
  returning * into v_asset;

  -- A posicao fisica em Raw corrige importacoes anteriores como Final.
  delete from public.drive_final_versions
  where workspace_id = p_workspace_id and asset_id = v_asset.id;
  if (select count(*) from public.drive_final_versions where workspace_id = p_workspace_id) = 1 then
    update public.drive_final_versions set version_number = 1 where workspace_id = p_workspace_id;
  end if;
  insert into public.drive_raw_asset_links (workspace_id, asset_id, shortcut_drive_file_id)
  values (p_workspace_id, v_asset.id, null)
  on conflict (workspace_id, asset_id) do update set shortcut_drive_file_id = null;

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
