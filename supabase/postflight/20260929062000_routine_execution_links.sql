do $$
begin
  if (select count(*) from public.routine_execution_links
      where template_id = '71e87469-990b-416e-9d0e-a6f57e781343'
        and cycle_id = 'e5f32ccc-154a-4d11-b5dc-1098bec58fcc'
        and occurrence_date = date '2026-09-16'
        and task_id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd') <> 1
    or exists (select 1 from public.task_links where parent_id = 'e5f32ccc-154a-4d11-b5dc-1098bec58fcc'
      and child_id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and relation_kind = 'structural_member')
    or not exists (select 1 from public.tasks where id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd'
      and client_id = '4f2bfda6-325d-4da3-94ff-c64802e1e2a4' and kind = 'plano_acao' and plan_id is null)
  then raise exception 'Routine execution postflight failed'; end if;
end $$;
