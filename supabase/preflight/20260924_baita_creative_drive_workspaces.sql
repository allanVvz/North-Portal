-- Somente leitura. Rodar antes da migration do piloto BAITA.
with plan_members as (
  select l.child_id
  from public.task_links l
  where l.parent_id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd'::uuid
    and l.relation_kind = 'structural_member'
), creatives as (
  select t.id, t.title, t.client_id
  from public.tasks t join plan_members pm on pm.child_id = t.id
  where t.kind = 'criativo' and t.subtype is null
), captures as (
  select c.id creative_id, l.child_id capture_id
  from creatives c join public.task_links l on l.parent_id = c.id
  where l.relation_kind = 'workflow_step' and l.slot = 'captacao'
), edits as (
  select c.id creative_id, l.child_id edit_id
  from creatives c join public.task_links l on l.parent_id = c.id
  where l.relation_kind = 'workflow_step' and l.slot = 'edicao'
)
select jsonb_pretty(jsonb_build_object(
  'migration_present', exists(select 1 from supabase_migrations.schema_migrations where version = '20260924023523'),
  'workspace_tables_present', (select count(*) from information_schema.tables where table_schema='public' and table_name in ('drive_capture_workspaces','drive_creative_workspaces','drive_assets','drive_raw_asset_links','drive_final_versions')),
  'raw_columns_present', (select count(*) from information_schema.columns where table_schema='public' and table_name='client_drive_links' and column_name in ('raw_folder_id','raw_url')),
  'plan', (select to_jsonb(p) from (select id,title,kind,client_id,plan_id from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd') p),
  'member_count', (select count(*) from plan_members),
  'creative_count', (select count(*) from creatives),
  'operational_count', (select count(*) from plan_members pm join public.tasks t on t.id=pm.child_id where not (t.kind='criativo' and t.subtype is null)),
  'capture_groups', (select coalesce(jsonb_agg(x order by x.capture_id), '[]'::jsonb) from (select capture_id, count(*) creative_count, array_agg(creative_id order by creative_id) creative_ids from captures group by capture_id) x),
  'creative_without_capture', (select count(*) from creatives c left join captures x on x.creative_id=c.id where x.capture_id is null),
  'creative_without_edit', (select count(*) from creatives c left join edits x on x.creative_id=c.id where x.edit_id is null),
  'client_folders', (select to_jsonb(d) from (select client_id,root_folder_id,brand_folder_id,products_folder_id,uploads_folder_id from public.client_drive_links where client_id=(select client_id from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd')) d),
  'invalid_blank_slots', (select count(*) from public.task_links where relation_kind='workflow_step' and (slot is null or btrim(slot)=''))
)) as preflight;
