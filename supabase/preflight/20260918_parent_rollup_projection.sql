-- Read-only production preflight for 20260918004358.
-- Save this output with the deployment evidence before applying the migration.

select version
from supabase_migrations.schema_migrations
order by version desc
limit 20;

select
  count(*) filter (where workflow_version_id is not null) as deliveries,
  count(*) filter (where kind = 'plano_acao') as plans,
  count(*) filter (where recurrence_cadence is not null) as recurring_cards,
  count(*) as tasks
from public.tasks;

-- A Delivery must have no more than one non-terminal workflow child.
select parent.id, parent.title, count(*) as open_steps
from public.tasks parent
join public.task_links link on link.parent_id = parent.id and link.relation_kind = 'workflow_step'
join public.tasks child on child.id = link.child_id and child.completed_at is null
where parent.workflow_version_id is not null
group by parent.id, parent.title
having count(*) > 1
order by parent.title;

-- Existing empty deliveries would make the commit-time guard fail. They must
-- be reconciled before this migration is applied.
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
  );

-- Later slots whose predecessor is not complete are the exact links that the
-- reconciliation will detach. The child records themselves are not deleted.
select parent.id as parent_id, parent.title as parent_title,
       child.id as child_id, child.title as child_title, step.step_key, step.order_index
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
order by parent.title, step.order_index;

-- Classification is already FK-driven; this must return zero rows.
select task.id, task.title, task.kind, task.subtype, task.task_type_id
from public.tasks task
left join public.task_types type on type.id = task.task_type_id
where type.id is null;
