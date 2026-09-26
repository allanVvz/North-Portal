-- Read-only production snapshot before format-specific daily workflows.
select now() as captured_at,
  (select count(*) from public.automation_configs where automation_key = 'diaria_recorrente') as daily_configs,
  (select count(*) from public.tasks where payload ? 'daily_config_id') as daily_cycles,
  (select count(*) from public.drive_creative_workspaces) as creative_workspaces,
  (select count(*) from public.drive_capture_workspaces) as capture_workspaces;

select version, name from supabase_migrations.schema_migrations
where version in ('20260925220658', '20260926000000', '20260926010000', '20260926020000')
order by version;

select t.key, t.id, t.behavior, v.id as workflow_id, v.version,
  array_agg(s.step_key order by s.order_index) as steps
from public.task_types t
left join public.workflow_versions v on v.delivery_type_id = t.id and v.status = 'published'
left join public.workflow_version_steps s on s.workflow_version_id = v.id
where t.key in ('criativo', 'entrega_reels', 'entrega_story',
  'entrega_carrossel', 'entrega_anuncio', 'entrega_banner')
group by t.key, t.id, t.behavior, v.id, v.version order by t.key;

select parent_id, workflow_step_id, count(*) as duplicate_slots
from public.task_links where relation_kind = 'workflow_step'
group by parent_id, workflow_step_id having count(*) > 1;

select client_id, count(*) as links,
  bool_and(raw_folder_id is not null and uploads_folder_id is not null) as ready
from public.client_drive_links group by client_id order by client_id;

select proname, pg_get_functiondef(oid) as definition
from pg_proc where oid in (
  'public.materialize_recurring_daily(uuid,date,jsonb)'::regprocedure,
  'public.workflow_version_transition_is_valid()'::regprocedure,
  'public.workflow_version_step_is_mutable()'::regprocedure
);
