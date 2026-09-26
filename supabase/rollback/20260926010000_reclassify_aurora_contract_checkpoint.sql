begin;

do $$
declare
  target_id constant uuid := '796483e5-13f1-4620-9e0d-2942b58494ac';
  plan_type_id uuid;
begin
  select id into plan_type_id from public.task_types
   where key = 'plano' and parent_id is null and active;
  if plan_type_id is null
     or not exists (select 1 from public.tasks where id = target_id
                    and title = 'Contrato Aurora' and kind = 'checkpoint_comercial'
                    and recurrence_cadence = 'mensal')
     or exists (select 1 from public.task_links where parent_id = target_id or child_id = target_id) then
    raise exception 'Rollback precondition failed';
  end if;
  update public.tasks set task_type_id = plan_type_id where id = target_id;
end;
$$;

commit;
