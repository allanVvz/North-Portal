select t.key, t.behavior, v.version, v.status,
  array_agg(s.step_key order by s.order_index) as steps
from public.task_types t
join public.workflow_versions v on v.delivery_type_id = t.id and v.status = 'published'
join public.workflow_version_steps s on s.workflow_version_id = v.id
where t.key in ('criativo', 'entrega_reels', 'entrega_story',
  'entrega_carrossel', 'entrega_anuncio', 'entrega_banner')
group by t.key, t.behavior, v.version, v.status order by t.key;

select p.proname, p.prosecdef, pg_get_functiondef(p.oid) like '%piece_workflow_id%' as piece_workflow_aware
from pg_proc p where p.oid = 'public.materialize_recurring_daily(uuid,date,jsonb)'::regprocedure;
select p.proname, p.prosecdef from pg_proc p
where p.oid = 'public.publish_delivery_workflow(uuid,jsonb)'::regprocedure;

select version, name from supabase_migrations.schema_migrations
where version = '20260926020000';
