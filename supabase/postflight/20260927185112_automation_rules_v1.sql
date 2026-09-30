-- Read-only equivalence check before adding the remote ledger entry.
select jsonb_build_object(
  'new_rules', (select count(*) from public.automation_rules),
  'new_versions', (select count(*) from public.automation_rule_versions),
  'new_bindings', (select count(*) from public.task_automation_bindings),
  'new_events', (select count(*) from public.automation_rule_events),
  'daily_script_versions', (select count(*) from public.daily_script_versions),
  'automation_configs', (select count(*) from public.automation_configs),
  'active_automation_configs', (select count(*) from public.automation_configs where active),
  'automation_config_fingerprint', (
    select md5(coalesce(string_agg(id::text || ':' || automation_key || ':' || target_task_id::text || ':' || active::text || ':' || coalesce(md5(daily_config::text), ''), '|' order by id), ''))
    from public.automation_configs
  ),
  'workflow_versions', (select count(*) from public.workflow_versions),
  'workflow_links', (select count(*) from public.task_links where relation_kind = 'workflow_step'),
  'task_types', (select count(*) from public.task_types),
  'rls_new_tables', (
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (
      'automation_rules', 'automation_rule_versions', 'task_automation_bindings', 'automation_rule_events',
      'daily_script_versions'
    ) and c.relrowsecurity
  ),
  'ledger_count', (select count(*) from supabase_migrations.schema_migrations),
  'ledger_latest', (select max(version) from supabase_migrations.schema_migrations)
) as result;
