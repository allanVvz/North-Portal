-- Read-only postflight for the unified Delivery workflow cutover.
select jsonb_build_object(
  'tasks_without_type_fk', (select count(*) from public.tasks where task_type_id is null),
  'workflow_links_without_step_fk', (
    select count(*) from public.task_links
    where relation_kind = 'workflow_step' and workflow_step_id is null
  ),
  'duplicate_delivery_steps', (
    select count(*) from (
      select parent_id, workflow_step_id
      from public.task_links
      where relation_kind = 'workflow_step'
      group by parent_id, workflow_step_id
      having count(*) > 1
    ) duplicates
  ),
  'incompatible_children', (
    select count(*)
    from public.task_links link
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    join public.tasks child on child.id = link.child_id
    where link.relation_kind = 'workflow_step'
      and child.task_type_id <> step.task_type_id
  ),
  'wrong_delivery_versions', (
    select count(*)
    from public.task_links link
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    join public.tasks parent on parent.id = link.parent_id
    where link.relation_kind = 'workflow_step'
      and parent.workflow_version_id <> step.workflow_version_id
  ),
  'deliveries_without_first_step', (
    select count(*)
    from public.tasks delivery
    where delivery.workflow_version_id is not null
      and delivery.payload->>'recurrence_group' is distinct from 'true'
      and not exists (
        select 1
        from public.workflow_version_steps first_step
        join public.task_links link
          on link.parent_id = delivery.id
         and link.workflow_step_id = first_step.id
         and link.relation_kind = 'workflow_step'
        where first_step.workflow_version_id = delivery.workflow_version_id
          and first_step.order_index = (
            select min(candidate.order_index)
            from public.workflow_version_steps candidate
            where candidate.workflow_version_id = delivery.workflow_version_id
          )
      )
  ),
  'legacy_payload_flags', (
    select count(*) from public.tasks
    where payload ?| array['flow_parent', 'automation_flow', 'flow_step_count', 'flow_total_weight', 'flow_step_key']
  ),
  'legacy_physical_task_types', (
    select count(*) from public.task_types
    where (parent_id is null and key not in ('tarefa', 'entrega', 'plano', 'checkpoint'))
       or key in ('operacional', 'relatorio_trafego', 'trafego', 'conversao')
  ),
  'automation_runs', (select count(*) from public.automation_runs),
  'ads_configs', (
    select count(*) from public.automation_configs
    where active and automation_key = 'relatorio_trafego_semanal'
  ),
  'conversion_configs', (
    select count(*) from public.automation_configs
    where active and automation_key = 'relatorio_vendas'
  ),
  'broken_dependencies', (
    select count(*)
    from public.automation_configs conversion
    left join public.automation_configs ads on ads.id = conversion.depends_on_config_id
    left join public.tasks conversion_target on conversion_target.id = conversion.target_task_id
    left join public.tasks ads_target on ads_target.id = ads.target_task_id
    where conversion.active
      and conversion.automation_key = 'relatorio_vendas'
      and (
        ads.id is null
        or ads.automation_key <> 'relatorio_trafego_semanal'
        or conversion_target.client_id is distinct from ads_target.client_id
      )
  ),
  'bootstrap_deliveries_2026_09_18', (
    select count(*) from public.tasks
    where kind = 'automacao' and payload->>'occurrence_date' = '2026-09-18'
  ),
  'cron_schedule', (
    select schedule from cron.job where jobname = 'automations-run-daily' limit 1
  ),
  'ledger_head', (
    select max(version) from supabase_migrations.schema_migrations
  )
) as unified_workflow_postflight;
