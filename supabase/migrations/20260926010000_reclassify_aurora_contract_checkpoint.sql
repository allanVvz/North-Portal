begin;

do $$
declare
  target_id constant uuid := '796483e5-13f1-4620-9e0d-2942b58494ac';
  target public.tasks;
  checkpoint_id uuid;
begin
  select * into target from public.tasks where id = target_id for update;
  select id into checkpoint_id from public.task_types
   where key = 'checkpoint' and parent_id is null and active;

  if target.id is null
     or target.title <> 'Contrato Aurora'
     or target.kind <> 'plano_acao'
     or target.recurrence_cadence <> 'mensal'
     or checkpoint_id is null
     or exists (select 1 from public.task_links where parent_id = target_id or child_id = target_id) then
    raise exception 'Precondition failed: Aurora contract classification changed';
  end if;

  update public.tasks set task_type_id = checkpoint_id where id = target_id;

  if not exists (select 1 from public.tasks where id = target_id and kind = 'checkpoint_comercial'
                 and recurrence_cadence = 'mensal') then
    raise exception 'Postcondition failed: checkpoint projection or recurrence changed';
  end if;
end;
$$;

commit;
