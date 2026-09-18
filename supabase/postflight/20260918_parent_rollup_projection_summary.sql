-- Single-result production verification for the Management API endpoint.
select jsonb_build_object(
  'multiple_open_steps', (
    select count(*)
    from (
      select parent.id
      from public.tasks parent
      join public.task_links link on link.parent_id = parent.id and link.relation_kind = 'workflow_step'
      join public.tasks child on child.id = link.child_id and child.completed_at is null
      where parent.workflow_version_id is not null
      group by parent.id
      having count(*) > 1
    ) invalid
  ),
  'invalid_sequential_links', (
    select count(*)
    from public.task_links link
    join public.tasks parent on parent.id = link.parent_id
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    where link.relation_kind = 'workflow_step'
      and exists (
        select 1
        from public.workflow_version_steps prior
        where prior.workflow_version_id = parent.workflow_version_id
          and prior.order_index < step.order_index
          and not exists (
            select 1
            from public.task_links prior_link
            join public.tasks prior_child on prior_child.id = prior_link.child_id
            where prior_link.parent_id = parent.id
              and prior_link.relation_kind = 'workflow_step'
              and prior_link.workflow_step_id = prior.id
              and prior_child.completed_at is not null
          )
      )
  ),
  'deliveries_without_first_step', (
    select count(*)
    from public.tasks parent
    where parent.workflow_version_id is not null
      and coalesce(parent.payload->>'recurrence_group', 'false') <> 'true'
      and not exists (
        select 1
        from public.task_links link
        join public.workflow_version_steps step on step.id = link.workflow_step_id
        where link.parent_id = parent.id
          and link.relation_kind = 'workflow_step'
          and step.workflow_version_id = parent.workflow_version_id
          and step.order_index = (
            select min(first_step.order_index)
            from public.workflow_version_steps first_step
            where first_step.workflow_version_id = parent.workflow_version_id
          )
      )
  ),
  'incompatible_workflow_links', (
    select count(*)
    from public.task_links link
    join public.tasks parent on parent.id = link.parent_id
    join public.tasks child on child.id = link.child_id
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    where link.relation_kind = 'workflow_step'
      and (parent.workflow_version_id is distinct from step.workflow_version_id
        or child.task_type_id is distinct from step.task_type_id)
  ),
  'projection_mismatches', (
    select count(*)
    from public.tasks parent
    where (parent.workflow_version_id is not null or parent.kind = 'plano_acao' or parent.recurrence_cadence is not null)
      and parent.status is distinct from public.project_parent_status(parent.id)
  ),
  'legacy_structural_payloads', (
    select count(*)
    from public.tasks
    where payload ?| array['flow_parent', 'automation_flow', 'flow_step_count', 'flow_total_weight', 'flow_step_key']
  ),
  'task_count', (select count(*) from public.tasks),
  'workflow_link_count', (select count(*) from public.task_links where relation_kind = 'workflow_step'),
  'automation_run_count', (select count(*) from public.automation_runs),
  'required_triggers', (
    select coalesce(jsonb_agg(tg.tgname order by tg.tgname), '[]'::jsonb)
    from pg_catalog.pg_trigger tg
    join pg_catalog.pg_class relation on relation.oid = tg.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('tasks', 'task_links')
      and not tg.tgisinternal
      and tg.tgname in (
        'tasks_reject_manual_rollup_status',
        'tasks_refresh_rollup_parents',
        'task_links_enforce_strict_workflow_sequence',
        'task_links_reject_structural_cycles',
        'task_links_refresh_rollup_parent',
        'task_links_delivery_first_step_required'
      )
  )
) as verification;
