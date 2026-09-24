select jsonb_pretty(jsonb_build_object(
  'tables', (select jsonb_agg(table_name order by table_name) from information_schema.tables where table_schema='public' and table_name like 'drive_%workspace%' or table_schema='public' and table_name in ('drive_assets','drive_raw_asset_links','drive_final_versions')),
  'rls_enabled', (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('drive_workspace_plan_allowlist','drive_capture_workspaces','drive_creative_workspaces','drive_assets','drive_raw_asset_links','drive_final_versions')),
  'required_columns', (select count(*) from information_schema.columns where table_schema='public' and ((table_name='client_drive_links' and column_name in ('raw_folder_id','raw_url')) or (table_name='drive_creative_workspaces' and column_name in ('routine_task_id','plan_task_id','capture_task_id','creative_task_id','stage_task_id','status','last_error','creative_folder_id','preview_folder_id')))),
  'check_constraints', (select count(*) from information_schema.table_constraints where table_schema='public' and table_name in ('drive_capture_workspaces','drive_creative_workspaces','drive_assets','drive_final_versions') and constraint_type='CHECK'),
  'indexes', (select count(*) from pg_indexes where schemaname='public' and indexname in ('drive_capture_workspaces_capture_idx','drive_creative_workspaces_plan_idx','drive_assets_workspace_role_idx','drive_final_versions_workspace_idx')),
  'updated_at_triggers', (select count(*) from information_schema.triggers where trigger_schema='public' and event_object_table in ('drive_workspace_plan_allowlist','drive_capture_workspaces','drive_creative_workspaces','drive_assets') and trigger_name='set_updated_at'),
  'asset_comment_rpc', to_regprocedure('public.append_task_comment_with_assets(uuid,uuid,text,text,uuid[])') is not null,
  'authenticated_grants', (select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and table_name in ('drive_workspace_plan_allowlist','drive_capture_workspaces','drive_creative_workspaces','drive_assets','drive_raw_asset_links','drive_final_versions')),
  'allowlist', (select to_jsonb(a) from public.drive_workspace_plan_allowlist a where plan_task_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'),
  'migration_present', exists(select 1 from supabase_migrations.schema_migrations where version='20260924023523'),
  'capture_workspaces', (select count(*) from public.drive_capture_workspaces where plan_task_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'),
  'creative_workspaces', (select count(*) from public.drive_creative_workspaces where plan_task_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'),
  'wrong_plan_workspaces', (select count(*) from public.drive_creative_workspaces where plan_task_id<>'7e1a162d-ff0f-414e-ad50-bea8b472fbcd')
  ,'baita_folders', (select to_jsonb(x) from (select uploads_folder_id,raw_folder_id from public.client_drive_links where client_id='4f2bfda6-325d-4da3-94ff-c64802e1e2a4') x)
)) as postflight;
