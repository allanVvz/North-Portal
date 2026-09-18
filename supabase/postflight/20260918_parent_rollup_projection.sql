-- Read-only postflight for 20260918004358.

-- No Delivery may retain two open workflow stages.
select parent.id, parent.title, count(*) as open_steps
from public.tasks parent
join public.task_links link on link.parent_id = parent.id and link.relation_kind = 'workflow_step'
join public.tasks child on child.id = link.child_id and child.completed_at is null
where parent.workflow_version_id is not null
group by parent.id, parent.title
having count(*) > 1;

-- Every non-template Delivery has the first declared step at commit.
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

-- Every linked workflow child remains compatible with its pinned version.
select parent.id, parent.title, child.id as child_id, child.title as child_title
from public.task_links link
join public.tasks parent on parent.id = link.parent_id
join public.tasks child on child.id = link.child_id
join public.workflow_version_steps step on step.id = link.workflow_step_id
where link.relation_kind = 'workflow_step'
  and (parent.workflow_version_id is distinct from step.workflow_version_id
    or child.task_type_id is distinct from step.task_type_id);

-- Stored state equals its canonical projection for all rollup parents.
select id, title, status, public.project_parent_status(id) as projected_status
from public.tasks
where (workflow_version_id is not null or kind = 'plano_acao' or recurrence_cadence is not null)
  and status is distinct from public.project_parent_status(id)
order by title;

select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('tasks', 'task_links')
  and trigger_name in (
    'tasks_reject_manual_rollup_status',
    'tasks_refresh_rollup_parents',
    'task_links_enforce_strict_workflow_sequence',
    'task_links_reject_structural_cycles',
    'task_links_refresh_rollup_parent',
    'task_links_delivery_first_step_required'
  )
order by trigger_name;
