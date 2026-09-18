-- Single-result production snapshot for the Management API read-only endpoint.
-- It complements the human-readable preflight with ledger, catalog and every
-- condition that can block the transaction.
select jsonb_build_object(
  'ledger', (
    select coalesce(jsonb_agg(version order by version desc), '[]'::jsonb)
    from (select version from supabase_migrations.schema_migrations order by version desc limit 20) ledger
  ),
  'counts', (
    select jsonb_build_object(
      'tasks', count(*),
      'deliveries', count(*) filter (where workflow_version_id is not null),
      'plans', count(*) filter (where kind = 'plano_acao'),
      'recurring_cards', count(*) filter (where recurrence_cadence is not null)
    )
    from public.tasks
  ),
  'multiple_open_steps', (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'open_steps', open_steps)), '[]'::jsonb)
    from (
      select parent.id, parent.title, count(*) as open_steps
      from public.tasks parent
      join public.task_links link on link.parent_id = parent.id and link.relation_kind = 'workflow_step'
      join public.tasks child on child.id = link.child_id and child.completed_at is null
      where parent.workflow_version_id is not null
      group by parent.id, parent.title
      having count(*) > 1
    ) invalid
  ),
  'invalid_sequential_links', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'parent_id', parent_id, 'parent_title', parent_title,
      'child_id', child_id, 'child_title', child_title,
      'step_key', step_key, 'order_index', order_index
    )), '[]'::jsonb)
    from (
      select parent.id as parent_id, parent.title as parent_title,
             child.id as child_id, child.title as child_title,
             step.step_key, step.order_index
      from public.task_links link
      join public.tasks parent on parent.id = link.parent_id
      join public.tasks child on child.id = link.child_id
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
    ) invalid
  ),
  'deliveries_without_first_step', (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title)), '[]'::jsonb)
    from (
      select parent.id, parent.title
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
    ) invalid
  ),
  'untyped_tasks', (
    select count(*)
    from public.tasks task
    left join public.task_types type on type.id = task.task_type_id
    where type.id is null
  )
) as snapshot;
