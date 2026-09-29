do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='north_ai_responsible')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='north_ai_reviewer') then
    raise exception 'North AI task role columns missing';
  end if;
  if to_regclass('public.task_activity_events') is null
     or to_regprocedure('public.decide_task_review(uuid,uuid,text,text,public.task_status,uuid,uuid,text)') is null then
    raise exception 'Review event table or atomic decision RPC missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname='capture_task_entered_review' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='capture_link_entered_review' and not tgisinternal) then
    raise exception 'Review entry triggers missing';
  end if;
end $$;
select count(*) as events_after_apply from public.task_activity_events;
