-- Run only after the one-shot Trello import has materialized every routine as
-- a task. Cycle completion now uses tasks directly with an optimistic due-date
-- token and a deterministic occurrence id, so no legacy RPC remains necessary.

drop function if exists public.materialize_recurring_occurrence(uuid, date);
drop function if exists public.complete_recurring_cycle(uuid, date);
drop function if exists public.complete_recurring_task(uuid);

drop table if exists public.trello_recurring_cache;
drop table if exists public.recurring_tasks;

alter table public.clients drop column if exists trello_list_id;
alter table public.tasks drop column if exists recurring_task_id;
