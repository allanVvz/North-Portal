-- Read-only equivalence check. Run before recording the ledger entry.
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='task_links'
        and column_name in ('status_override', 'completed_at_override', 'paused_from_status')) <> 3 then
    raise exception 'Missing delivery-stage override columns';
  end if;
  if (select count(*) from pg_constraint
      where conrelid='public.task_links'::regclass
        and conname in ('task_links_stage_override_complete_check', 'task_links_stage_pause_check')) <> 2 then
    raise exception 'Missing delivery-stage override constraints';
  end if;
  if to_regprocedure('public.set_delivery_stage_status(uuid,uuid,public.task_status,public.task_status)') is null then
    raise exception 'Missing delivery-stage status RPC';
  end if;
  if exists (select 1 from public.task_links
      where (status_override is null and completed_at_override is not null)
         or (status_override = 'aprovado' and completed_at_override is null)
         or (status_override is not null and status_override <> 'aprovado' and completed_at_override is not null)) then
    raise exception 'Invalid delivery-stage override data';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'project_parent_status','activate_delivery_if_started',
        'workflow_link_is_strictly_sequential','delivery_workflow_is_consistent',
        'delivery_classification_is_mutable'
      ) and pg_get_functiondef(p.oid) like '%status_override%') <> 5 then
    raise exception 'A parent workflow function still ignores contextual status';
  end if;
end;
$$;

select column_name, data_type, udt_name from information_schema.columns
where table_schema='public' and table_name='task_links'
  and column_name in ('status_override','completed_at_override','paused_from_status')
order by column_name;
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.task_links'::regclass and conname like 'task_links_stage_%';
select p.proname, pg_get_functiondef(p.oid) from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'project_parent_status','activate_delivery_if_started',
  'workflow_link_is_strictly_sequential','delivery_workflow_is_consistent',
  'delivery_classification_is_mutable','set_delivery_stage_status'
) order by p.proname;
select version, name from supabase_migrations.schema_migrations
where version='20260925061042';
