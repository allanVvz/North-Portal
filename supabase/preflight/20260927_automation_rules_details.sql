select jsonb_build_object(
  'ledger_columns', (
    select jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default) order by ordinal_position)
    from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
  ),
  'new_objects_absent',
    to_regclass('public.automation_rules') is null
    and to_regclass('public.automation_rule_versions') is null
    and to_regclass('public.daily_script_versions') is null,
  'baita_daily', (
    select jsonb_build_object(
      'active', config.active,
      'piece_count', jsonb_array_length(config.daily_config->'pieces'),
      'has_script_doc', config.daily_config->>'scriptDocUrl' is not null,
      'has_root', links.root_folder_id is not null,
      'has_raw', links.raw_folder_id is not null,
      'has_editing', links.uploads_folder_id is not null,
      'recurrence', task.recurrence_cadence,
      'next_due', task.due_date
    )
    from public.automation_configs config
    join public.tasks task on task.id = config.target_task_id
    join public.clients client on client.id = task.client_id
    left join public.client_drive_links links on links.client_id = client.id
    where client.slug = 'baita-conveniencia' and config.automation_key = 'diaria_recorrente'
    limit 1
  ),
  'task_type_columns', (
    select jsonb_agg(column_name order by ordinal_position)
    from information_schema.columns where table_schema = 'public' and table_name = 'task_types'
  )
) as details;
