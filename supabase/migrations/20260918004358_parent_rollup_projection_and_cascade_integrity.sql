-- Parent projection and strict workflow cascade.
--
-- This migration deliberately never deletes a task, document, report, comment
-- or automation run. A malformed future workflow relationship is removed; its
-- child remains a standalone Task with the same id and audit trail.
begin;

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

create or replace function public.refresh_parent_rollup(p_parent_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare expected_status public.task_status;
begin
  select public.project_parent_status(p_parent_id) into expected_status;
  perform set_config('north.rollup_refresh', 'on', true);
  update public.tasks
  set status = expected_status
  where id = p_parent_id and status is distinct from expected_status;
  perform set_config('north.rollup_refresh', 'off', true);
end;
$$;

-- `workflow_activated_at` is a fact, not a second status.  It is stamped
-- once, at the exact moment the first workflow child leaves Entrada.  Keeping
-- it here lets the database protect the type/version lock even when a writer
-- bypasses the HTTP API.
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

-- The existing task constraint covers the parent insert, but a later DELETE
-- from task_links is a different statement. Make the "first step exists"
-- invariant explicit at transaction commit so an unlink/reconciliation cannot
-- leave an invisible, empty Delivery behind.
create or replace function public.assert_delivery_has_first_step(p_parent_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare parent_version_id uuid;
declare is_recurrence_template boolean;
begin
  select workflow_version_id, coalesce(payload->>'recurrence_group', 'false') = 'true'
    into parent_version_id, is_recurrence_template
  from public.tasks
  where id = p_parent_id;
  if parent_version_id is null or is_recurrence_template then return; end if;

  if not exists (
    select 1
    from public.task_links link
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    where link.parent_id = p_parent_id
      and link.relation_kind = 'workflow_step'
      and step.workflow_version_id = parent_version_id
      and step.order_index = (
        select min(first_step.order_index)
        from public.workflow_version_steps first_step
        where first_step.workflow_version_id = parent_version_id
      )
  ) then
    raise exception 'A Delivery cannot exist without its first workflow step' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.task_link_preserves_delivery_first_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then perform public.assert_delivery_has_first_step(old.parent_id); end if;
  if tg_op <> 'DELETE' then perform public.assert_delivery_has_first_step(new.parent_id); end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_rollup_parents_of_task()
returns trigger
language plpgsql
set search_path = ''
as $$
declare related_parent_id uuid;
begin
  for related_parent_id in
    select link.parent_id
    from public.task_links link
    where link.child_id = new.id
      and link.relation_kind in ('structural_member', 'workflow_step')
    union
    select new.plan_id where new.plan_id is not null
  loop
    perform public.activate_delivery_if_started(related_parent_id);
    perform public.refresh_parent_rollup(related_parent_id);
  end loop;
  return new;
end;
$$;

create or replace function public.refresh_rollup_parent_from_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.activate_delivery_if_started(old.parent_id);
    perform public.refresh_parent_rollup(old.parent_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.activate_delivery_if_started(new.parent_id);
    perform public.refresh_parent_rollup(new.parent_id);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.reject_manual_rollup_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Updates emitted by refresh_parent_rollup are nested trigger work. A direct
  -- client/API update enters at depth 1 and is rejected before it can create a
  -- second source of truth.
  if coalesce(current_setting('north.rollup_refresh', true), 'off') <> 'on'
     and new.status is distinct from old.status
     and (old.workflow_version_id is not null or old.kind = 'plano_acao' or old.recurrence_cadence is not null) then
    raise exception 'Parent card status is projected from descendants' using errcode = '23514';
  end if;
  return new;
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

create or replace function public.structural_link_has_no_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.relation_kind <> 'structural_member' then return new; end if;
  if new.parent_id = new.child_id or exists (
    with recursive descendants(id, path) as (
      select link.child_id, array[link.parent_id, link.child_id]
      from public.task_links link
      where link.parent_id = new.child_id and link.relation_kind = 'structural_member'
      union all
      select link.child_id, descendants.path || link.child_id
      from descendants
      join public.task_links link on link.parent_id = descendants.id
      where link.relation_kind = 'structural_member'
        and not link.child_id = any(descendants.path)
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'A structural Plan link may not create a cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists task_links_enforce_strict_workflow_sequence on public.task_links;
create trigger task_links_enforce_strict_workflow_sequence
  before insert or update of parent_id, child_id, relation_kind, workflow_step_id on public.task_links
  for each row execute function public.workflow_link_is_strictly_sequential();

drop trigger if exists task_links_reject_structural_cycles on public.task_links;
create trigger task_links_reject_structural_cycles
  before insert or update of parent_id, child_id, relation_kind on public.task_links
  for each row execute function public.structural_link_has_no_cycle();

drop trigger if exists tasks_reject_manual_rollup_status on public.tasks;
create trigger tasks_reject_manual_rollup_status
  before update of status on public.tasks
  for each row execute function public.reject_manual_rollup_status();

drop trigger if exists tasks_refresh_rollup_parents on public.tasks;
create trigger tasks_refresh_rollup_parents
  after insert or update of status, completed_at, plan_id on public.tasks
  for each row execute function public.refresh_rollup_parents_of_task();

drop trigger if exists task_links_refresh_rollup_parent on public.task_links;
create trigger task_links_refresh_rollup_parent
  after insert or update or delete on public.task_links
  for each row execute function public.refresh_rollup_parent_from_link();

drop trigger if exists task_links_delivery_first_step_required on public.task_links;
create constraint trigger task_links_delivery_first_step_required
  after insert or update or delete on public.task_links
  deferrable initially deferred
  for each row execute function public.task_link_preserves_delivery_first_step();

-- Reconcile legacy Delivery graphs without dropping cards. Any link whose
-- declared predecessor is absent or unfinished is removed; its child record
-- becomes a standalone Task and retains its subtype, files, comments and
-- history. This is the only safe repair for an old graph that materialized
-- future stages ahead of the cascade.
with invalid_sequential_links as (
  select link.parent_id, link.child_id, link.workflow_step_id
  from public.task_links link
  join public.tasks parent on parent.id = link.parent_id
  join public.workflow_version_steps step on step.id = link.workflow_step_id
  where link.relation_kind = 'workflow_step'
    and exists (
      select 1
      from public.workflow_version_steps prior
      where prior.workflow_version_id = parent.workflow_version_id
        and prior.order_index < step.order_index
        and not exists (
          select 1
          from public.task_links prior_link
          join public.tasks prior_child on prior_child.id = prior_link.child_id
          where prior_link.parent_id = parent.id
            and prior_link.relation_kind = 'workflow_step'
            and prior_link.workflow_step_id = prior.id
            and prior_child.completed_at is not null
        )
    )
)
delete from public.task_links link
using invalid_sequential_links invalid
where link.parent_id = invalid.parent_id
  and link.child_id = invalid.child_id
  and link.workflow_step_id = invalid.workflow_step_id
  and link.relation_kind = 'workflow_step';

-- Every existing parent is normalized through the same projection after the
-- malformed links are gone. Ancestor refreshes run through the triggers.
do $$
declare parent_id uuid;
begin
  for parent_id in
    select id from public.tasks
    where workflow_version_id is not null
       or kind = 'plano_acao'
       or recurrence_cadence is not null
  loop
    perform public.refresh_parent_rollup(parent_id);
  end loop;
end;
$$;

-- The old report cutover already guarantees type projection. Keep this
-- assertion here so a future manual repair cannot silently reintroduce a
-- Delivery subtype or an untyped workflow child.
do $$
begin
  if exists (
    select 1
    from public.task_links link
    join public.tasks parent on parent.id = link.parent_id
    join public.tasks child on child.id = link.child_id
    join public.workflow_version_steps step on step.id = link.workflow_step_id
    where link.relation_kind = 'workflow_step'
      and (parent.workflow_version_id is distinct from step.workflow_version_id
        or child.task_type_id is distinct from step.task_type_id)
  ) then
    raise exception 'Workflow reconciliation left an incompatible linked subtype';
  end if;
end;
$$;

commit;
