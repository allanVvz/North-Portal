-- Read-only baseline. Run before 20260927185112_automation_rules_v1.sql.
select jsonb_build_object(
  'project', current_database(),
  'captured_at', now(),
  'automation_configs', (select count(*) from public.automation_configs),
  'active_automation_configs', (select count(*) from public.automation_configs where active),
  'automation_config_fingerprint', (
    select md5(coalesce(string_agg(id::text || ':' || automation_key || ':' || target_task_id::text || ':' || active::text || ':' || coalesce(md5(daily_config::text), ''), '|' order by id), ''))
    from public.automation_configs
  ),
  'baita_daily_configs', (
    select count(*) from public.automation_configs config
    join public.tasks task on task.id = config.target_task_id
    join public.clients client on client.id = task.client_id
    where client.slug = 'baita-conveniencia' and config.automation_key = 'diaria_recorrente'
  ),
  'workflow_versions', (select count(*) from public.workflow_versions),
  'workflow_links', (select count(*) from public.task_links where relation_kind = 'workflow_step'),
  'task_types', (select count(*) from public.task_types),
  'schema_fingerprint', (
    select md5(string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable, '|' order by table_name, ordinal_position))
    from information_schema.columns
    where table_schema = 'public' and table_name in (
      'automation_configs', 'automation_runs', 'tasks', 'task_types',
      'workflow_versions', 'workflow_version_steps', 'task_links', 'client_drive_links'
    )
  ),
  'ledger_count', (select count(*) from supabase_migrations.schema_migrations),
  'ledger_latest', (select max(version) from supabase_migrations.schema_migrations)
) as baseline;
