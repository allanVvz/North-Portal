-- Read-only production preflight for the versioned Delivery workflow cutover.
-- Safe to rerun. It intentionally returns counts and catalog shape only; no
-- document URLs, storage paths, credentials, comments or customer content.
with wanted_clients as (
  select id, name, slug
  from public.clients
  where name in (
    'CRIS CAR CARE',
    'UTZIG GARAGE',
    'Karpinski',
    'ROSE DIAS',
    'Baita Conveniência'
  )
),
task_shape as (
  select
    count(*) filter (where coalesce(payload->>'flow_parent', 'false') = 'true') as flow_parents,
    count(*) filter (where kind in ('operacional', 'criativo', 'relatorio_conversao')) as legacy_kind_rows,
    count(*) filter (where subtype in ('relatorio_trafego', 'conversao', 'relatorio_conversao')) as legacy_subtype_rows
  from public.tasks
),
link_shape as (
  select
    count(*) filter (where relation_kind = 'workflow_step') as workflow_links,
    count(*) filter (
      where relation_kind = 'workflow_step'
        and (slot is null or btrim(slot) = '')
    ) as invalid_slots,
    count(*) as total_links
  from public.task_links
),
config_shape as (
  select
    count(*) filter (where automation_key = 'relatorio_trafego_semanal') as ads_configs,
    count(*) filter (where automation_key = 'relatorio_vendas') as conversion_configs,
    count(*) filter (
      where automation_key = 'relatorio_vendas'
        and depends_on_config_id is null
    ) as missing_dependencies
  from public.automation_configs
  where active
),
catalog_shape as (
  select jsonb_agg(
    jsonb_build_object(
      'key', key,
      'behavior', behavior,
      'active', active,
      'children', (select count(*) from public.task_types child where child.parent_id = root.id)
    )
    order by order_index
  ) as roots
  from public.task_types root
  where parent_id is null
),
columns_shape as (
  select jsonb_agg(jsonb_build_object('table', table_name, 'columns', columns) order by table_name) as tables
  from (
    select table_name, jsonb_agg(column_name order by ordinal_position) as columns
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'tasks', 'task_links', 'task_types', 'task_type_workflow_steps',
        'workflow_versions', 'workflow_version_steps', 'automation_configs',
        'automation_runs'
      )
    group by table_name
  ) listed
),
ledger as (
  select jsonb_agg(version order by version desc) as latest
  from (
    select version
    from supabase_migrations.schema_migrations
    order by version desc
    limit 12
  ) recent
),
cron_shape as (
  select jsonb_agg(
    jsonb_build_object('jobname', jobname, 'schedule', schedule, 'active', active)
    order by jobname
  ) as jobs
  from cron.job
  where jobname ilike '%autom%'
     or jobname ilike '%relatorio%'
)
select jsonb_build_object(
  'project_ref', 'rqwycltgnnvaunvmyxea',
  'captured_at', now(),
  'clients', (
    select jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by name)
    from wanted_clients
  ),
  'tasks', (select to_jsonb(task_shape) from task_shape),
  'links', (select to_jsonb(link_shape) from link_shape),
  'configs', (select to_jsonb(config_shape) from config_shape),
  'catalog', (select roots from catalog_shape),
  'schema', (select tables from columns_shape),
  'ledger', (select latest from ledger),
  'cron', (select jobs from cron_shape)
) as preflight;
