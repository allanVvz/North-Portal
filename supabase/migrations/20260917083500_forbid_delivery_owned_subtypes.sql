-- The workflow map is now the only valid composition for an Entrega. Keep a
-- direct SQL writer from recreating the retired parent_id topology.

create or replace function public.task_type_cannot_belong_to_delivery()
returns trigger
language plpgsql
as $$
declare
  parent_behavior text;
begin
  if new.parent_id is null then
    return new;
  end if;
  select behavior into parent_behavior from public.task_types where id = new.parent_id;
  if parent_behavior = 'entrega' then
    raise exception 'An Entrega cannot own subtype rows; use task_type_workflow_steps' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists task_types_forbid_delivery_owned_subtypes on public.task_types;
create trigger task_types_forbid_delivery_owned_subtypes
  before insert or update of parent_id on public.task_types
  for each row execute function public.task_type_cannot_belong_to_delivery();
