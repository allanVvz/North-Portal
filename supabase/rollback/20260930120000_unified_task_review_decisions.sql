begin;
drop trigger if exists capture_link_entered_review on public.task_links;
drop trigger if exists capture_task_entered_review on public.tasks;
drop function if exists public.capture_link_entered_review();
drop function if exists public.capture_task_entered_review();
drop function if exists public.notify_review_entry(uuid,boolean);
drop function if exists public.decide_task_review(uuid,uuid,text,text,public.task_status,uuid,uuid,text);
do $$
begin
  if to_regclass('public.task_activity_events') is not null
     and to_regclass('public.task_activity_events_rollback_20260930') is null then
    alter table public.task_activity_events rename to task_activity_events_rollback_20260930;
  end if;
end $$;
alter table public.tasks drop column if exists north_ai_responsible;
alter table public.tasks drop column if exists north_ai_reviewer;
commit;
