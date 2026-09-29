begin;
-- The 29/09 preflight found no structural link, so rollback restores that
-- observed state. Inspect later links before running this destructive rollback.
drop table public.routine_execution_links;
drop function public.validate_routine_execution_link();
commit;
