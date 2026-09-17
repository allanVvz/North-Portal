-- An Entrega declares a sequence; the work performed in that sequence is
-- always a subtype of the canonical common Task (`operacional`).  A junction
-- preserves both truths with foreign keys: no Delivery-owned subtype rows.

create table if not exists public.task_type_workflow_steps (
  delivery_type_id uuid not null references public.task_types(id) on delete cascade,
  task_subtype_id uuid not null references public.task_types(id) on delete restrict,
  order_index integer not null check (order_index >= 0),
  primary key (delivery_type_id, task_subtype_id),
  unique (delivery_type_id, order_index)
);

create index if not exists task_type_workflow_steps_delivery_order_idx
  on public.task_type_workflow_steps (delivery_type_id, order_index);

create or replace function public.task_type_workflow_step_is_valid()
returns trigger
language plpgsql
as $$
declare
  delivery_behavior text;
  delivery_is_root boolean;
  task_parent_key text;
begin
  select behavior, parent_id is null
    into delivery_behavior, delivery_is_root
    from public.task_types
   where id = new.delivery_type_id;

  if delivery_behavior is distinct from 'entrega' or not coalesce(delivery_is_root, false) then
    raise exception 'workflow delivery must be a top-level Entrega' using errcode = 'check_violation';
  end if;

  select parent.key
    into task_parent_key
    from public.task_types step
    join public.task_types parent on parent.id = step.parent_id
   where step.id = new.task_subtype_id;

  if task_parent_key is distinct from 'operacional' then
    raise exception 'workflow step must be a subtype of operacional' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists task_type_workflow_steps_validate on public.task_type_workflow_steps;
create trigger task_type_workflow_steps_validate
  before insert or update on public.task_type_workflow_steps
  for each row execute function public.task_type_workflow_step_is_valid();

alter table public.task_type_workflow_steps enable row level security;
drop policy if exists "task type workflow steps admin only" on public.task_type_workflow_steps;
create policy "task type workflow steps admin only"
  on public.task_type_workflow_steps
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

do $$
declare
  common_type_id uuid;
begin
  select id into common_type_id
    from public.task_types
   where parent_id is null and key = 'operacional';
  if common_type_id is null then
    raise exception 'Canonical operacional task type is required';
  end if;

  -- The inactive children below an active Delivery are the old, duplicated
  -- declaration. Convert their order into FK-backed workflow composition.
  insert into public.task_type_workflow_steps (delivery_type_id, task_subtype_id, order_index)
  select delivery.id, common_step.id, legacy_step.order_index
    from public.task_types delivery
    join public.task_types legacy_step on legacy_step.parent_id = delivery.id
    join public.task_types common_step
      on common_step.parent_id = common_type_id
     and common_step.key = legacy_step.key
   where delivery.parent_id is null
     and delivery.behavior = 'entrega'
     and delivery.active
  on conflict (delivery_type_id, task_subtype_id)
    do update set order_index = excluded.order_index;

  -- There are no remaining tasks classified by a Delivery-owned subtype: the
  -- previous migration moved them to operacional/<subtype>. Delete the old
  -- rows rather than keeping an inactive second vocabulary.
  delete from public.task_types legacy_step
   using public.task_types delivery
   where legacy_step.parent_id = delivery.id
     and delivery.parent_id is null
     and delivery.behavior = 'entrega';

  -- Hidden root kinds without any task are historical vocabulary, not an
  -- archive. Removing them prevents a future reactivation from reviving an
  -- incompatible model.
  delete from public.task_types root
   where root.parent_id is null
     and not root.active
     and not exists (select 1 from public.tasks task where task.kind = root.key);

  if exists (
    select 1
      from public.task_types step
      join public.task_types delivery on delivery.id = step.parent_id
     where delivery.parent_id is null and delivery.behavior = 'entrega'
  ) then
    raise exception 'Delivery-owned subtype rows remain after normalization';
  end if;

  if exists (
    select 1
      from public.task_type_workflow_steps ws
      join public.task_types step on step.id = ws.task_subtype_id
      join public.task_types parent on parent.id = step.parent_id
     where parent.key <> 'operacional'
  ) then
    raise exception 'Workflow map points outside common Task subtypes';
  end if;

  if exists (
    select 1
      from public.task_types delivery
     where delivery.parent_id is null
       and delivery.behavior = 'entrega'
       and delivery.active
       and not exists (
         select 1 from public.task_type_workflow_steps ws
          where ws.delivery_type_id = delivery.id
       )
  ) then
    raise exception 'An active Delivery has no workflow steps';
  end if;
end;
$$;
