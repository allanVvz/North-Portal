-- Read-only snapshot. Capture the output before applying the migration.
select now() as captured_at,
  (select count(*) from public.task_links where relation_kind = 'workflow_step') as workflow_links,
  (select count(distinct child_id) from public.task_links where relation_kind = 'workflow_step') as stage_cards,
  (select count(*) from (
    select child_id from public.task_links where relation_kind = 'workflow_step'
    group by child_id having count(*) > 1
  ) shared) as shared_stage_cards;

select link.parent_id, link.child_id, link.workflow_step_id
from public.task_links link
join public.tasks parent on parent.id = link.parent_id
join public.tasks child on child.id = link.child_id
left join public.workflow_version_steps step on step.id = link.workflow_step_id
where link.relation_kind = 'workflow_step'
  and (step.id is null or parent.workflow_version_id is distinct from step.workflow_version_id
    or child.task_type_id is distinct from step.task_type_id);

select parent_id, workflow_step_id, count(*)
from public.task_links where relation_kind = 'workflow_step'
group by parent_id, workflow_step_id having count(*) > 1;

select column_name, data_type, udt_name from information_schema.columns
where table_schema = 'public' and table_name = 'task_links' order by ordinal_position;
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.task_links'::regclass order by conname;
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.task_links'::regclass and not tgisinternal order by tgname;
select p.proname, pg_get_functiondef(p.oid) from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'project_parent_status', 'activate_delivery_if_started',
  'workflow_link_is_strictly_sequential', 'delivery_workflow_is_consistent',
  'delivery_classification_is_mutable', 'set_delivery_stage_status'
) order by p.proname;
select version, name from supabase_migrations.schema_migrations
order by version desc limit 30;
