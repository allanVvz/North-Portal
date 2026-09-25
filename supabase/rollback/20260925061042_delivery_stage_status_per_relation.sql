-- Reverte somente as funções. As colunas/overrides ficam preservados para recuperação.

-- Após aplicar, reverta também o código do app para a versão anterior.

begin;

revoke all on function public.set_delivery_stage_status(uuid, uuid, public.task_status, public.task_status) from authenticated;
drop function if exists public.set_delivery_stage_status(uuid, uuid, public.task_status, public.task_status);

create or replace function public.project_parent_status(
  p_task_id uuid,
  p_seen uuid[] default '{}'::uuid[]
)
returns public.task_status
language plpgsql
stable
set search_path = ''
as $$
declare
  parent_task public.tasks;
  member_task public.tasks;
  current_status public.task_status;
  expected_count integer;
  completed_count integer;
  active_occurrence_id uuid;
  best_rank integer := -1;
  best_status public.task_status := 'backlog';
  member_status public.task_status;
  member_rank integer;
begin
  select * into parent_task from public.tasks where id = p_task_id;
  if parent_task.id is null or p_task_id = any(p_seen) then
    return 'backlog';
  end if;
  p_seen := array_append(p_seen, p_task_id);

  -- A recurring Delivery template is a recurrence first, not an occurrence.
  if parent_task.recurrence_cadence is not null
     and coalesce(parent_task.payload->>'recurrence_group', 'false') = 'true' then
    select occurrence.id into active_occurrence_id
    from public.tasks occurrence
    where occurrence.plan_id = parent_task.id
      and occurrence.completed_at is null
    order by occurrence.due_date desc nulls last, occurrence.created_at desc
    limit 1;
    if active_occurrence_id is not null then
      return public.project_parent_status(active_occurrence_id, p_seen);
    end if;
    -- A deliberately stopped/finished routine remains terminal. Any old
    -- stored operational state is ignored: an active routine without a cycle
    -- is waiting in Entrada.
    if parent_task.status in ('aprovado', 'parada') then return parent_task.status; end if;
    return 'backlog';
  end if;

  -- Delivery is serial: exactly the first incomplete declared step is current.
  if parent_task.workflow_version_id is not null then
    select child.status into current_status
    from public.task_links link
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    join public.tasks child on child.id = link.child_id
    where link.parent_id = parent_task.id
      and link.relation_kind = 'workflow_step'
      and step.workflow_version_id = parent_task.workflow_version_id
      and child.completed_at is null
    order by step.order_index
    limit 1;
    if current_status is not null then return current_status; end if;

    select count(*) into expected_count
    from public.workflow_version_steps
    where workflow_version_id = parent_task.workflow_version_id;
    select count(*) into completed_count
    from public.workflow_version_steps declared
    join public.task_links link
      on link.parent_id = parent_task.id
     and link.relation_kind = 'workflow_step'
     and link.workflow_step_id = declared.id
    join public.tasks child on child.id = link.child_id and child.completed_at is not null
    where declared.workflow_version_id = parent_task.workflow_version_id;
    if expected_count > 0 and completed_count = expected_count then return 'aprovado'; end if;
    return 'backlog';
  end if;

  -- A non-plan, non-recurring card owns its status.
  if parent_task.kind <> 'plano_acao' then return parent_task.status; end if;

  -- Plan members are parallel. The highest operational priority wins; a plan
  -- only becomes approved when every effective member is approved.
  for member_task in
    select child.*
    from public.task_links link
    join public.tasks child on child.id = link.child_id
    where link.parent_id = parent_task.id
      and link.relation_kind = 'structural_member'
  loop
    if member_task.workflow_version_id is not null
       or member_task.kind = 'plano_acao'
       or member_task.recurrence_cadence is not null then
      member_status := public.project_parent_status(member_task.id, p_seen);
    else
      member_status := member_task.status;
    end if;
    member_rank := case member_status
      when 'parada' then 5
      when 'revisao' then 4
      when 'aprovacao' then 3
      when 'em_producao' then 2
      when 'backlog' then 1
      else 0
    end;
    if member_rank > best_rank then
      best_rank := member_rank;
      best_status := member_status;
    end if;
  end loop;
  if best_rank < 0 then return 'backlog'; end if;
  return best_status;
end;
$$;

create or replace function public.activate_delivery_if_started(p_parent_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.tasks parent
  set workflow_activated_at = coalesce(parent.workflow_activated_at, now())
  where parent.id = p_parent_id
    and parent.workflow_version_id is not null
    and parent.workflow_activated_at is null
    and exists (
      select 1
      from public.task_links link
      join public.tasks child on child.id = link.child_id
      where link.parent_id = parent.id
        and link.relation_kind = 'workflow_step'
        and child.status <> 'backlog'
    );
end;
$$;

create or replace function public.workflow_link_is_strictly_sequential()
returns trigger
language plpgsql
set search_path = ''
as $$
declare parent_version_id uuid;
declare target_order integer;
begin
  if new.relation_kind <> 'workflow_step' then return new; end if;
  select workflow_version_id into parent_version_id from public.tasks where id = new.parent_id;
  select order_index into target_order from public.workflow_version_steps where id = new.workflow_step_id;
  if parent_version_id is null or target_order is null then return new; end if;

  -- Every preceding declared step must be linked and completed before a later
  -- slot can exist. This gives each Delivery one contiguous completed prefix
  -- plus, at most, one current open step.
  if exists (
    select 1
    from public.workflow_version_steps previous_step
    where previous_step.workflow_version_id = parent_version_id
      and previous_step.order_index < target_order
      and not exists (
        select 1
        from public.task_links previous_link
        join public.tasks previous_child on previous_child.id = previous_link.child_id
        where previous_link.parent_id = new.parent_id
          and previous_link.relation_kind = 'workflow_step'
          and previous_link.workflow_step_id = previous_step.id
          and previous_child.completed_at is not null
      )
  ) then
    raise exception 'A workflow step may only be linked after every previous step is complete' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.task_links open_link
    join public.tasks open_child on open_child.id = open_link.child_id
    where open_link.parent_id = new.parent_id
      and open_link.relation_kind = 'workflow_step'
      and open_link.workflow_step_id is distinct from new.workflow_step_id
      and open_child.completed_at is null
  ) then
    raise exception 'A Delivery may have only one open workflow step' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.delivery_workflow_is_consistent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  declared_count integer;
  linked_count integer;
  first_linked boolean;
begin
  if new.workflow_version_id is null then
    if new.workflow_activated_at is not null then
      raise exception 'workflow_activated_at requires workflow_version_id' using errcode = '23514';
    end if;
    return new;
  end if;

  select count(*) into declared_count
  from public.workflow_version_steps where workflow_version_id = new.workflow_version_id;
  if declared_count = 0 then
    raise exception 'Delivery workflow version has no declared steps' using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.task_links link
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    where link.parent_id = new.id
      and link.relation_kind = 'workflow_step'
      and step.workflow_version_id = new.workflow_version_id
      and step.order_index = (
        select min(first_step.order_index)
        from public.workflow_version_steps first_step
        where first_step.workflow_version_id = new.workflow_version_id
      )
  ) into first_linked;

  if coalesce(new.payload->>'recurrence_group', 'false') <> 'true' and not first_linked then
    raise exception 'A Delivery cannot exist without its first workflow step' using errcode = '23514';
  end if;

  if new.status in ('aprovado', 'concluido') then
    select count(*) into linked_count
    from public.workflow_version_steps declared
    join public.task_links link
      on link.workflow_step_id = declared.id
     and link.parent_id = new.id
     and link.relation_kind = 'workflow_step'
    join public.tasks child on child.id = link.child_id
    where declared.workflow_version_id = new.workflow_version_id
      and child.completed_at is not null;
    if linked_count <> declared_count then
      raise exception 'Delivery cannot finish before every declared workflow step is complete' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.delivery_classification_is_mutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_type_id is distinct from old.task_type_id and exists (
    select 1
    from public.task_links link
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    where link.child_id = old.id
      and link.relation_kind = 'workflow_step'
      and step.task_type_id is distinct from new.task_type_id
  ) then
    raise exception 'Task subtype is incompatible with its workflow step' using errcode = '23514';
  end if;

  if old.task_type_id is not distinct from new.task_type_id
     and old.workflow_version_id is not distinct from new.workflow_version_id then
    return new;
  end if;

  if exists (
    select 1
    from public.task_links link
    join public.tasks child on child.id = link.child_id
    where link.parent_id = old.id
      and link.relation_kind = 'workflow_step'
      and child.status <> 'backlog'
  ) then
    raise exception 'Delivery type and workflow version are immutable after activation' using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;
