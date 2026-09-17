-- Reconciles the four historical cards that had more than one ownership edge.
--
-- Product decision (2026-09-17): a recurring template owns its dated plan
-- occurrence through tasks.plan_id / payload.recurrence_parent_id. The plan
-- occurrence owns its work structurally. A direct template -> work connection
-- may remain for navigation, but it is contextual (`reference`), never a
-- second family owner.
--
-- This migration intentionally identifies the two reviewed families by their
-- stable production ids. It will fail rather than guess if the reviewed graph
-- is no longer present. It does not delete tasks; it only changes/removes
-- links and preserves a reference for the direct recurrence context.

do $$
declare
  meeting_template constant uuid := '1d6239fd-c535-5405-92ef-bfaf8a639821';
  portal_occurrence constant uuid := '01220f73-3f62-40a0-85cb-a1b8e8b83078';
  september_plan constant uuid := '1f179322-90f0-4a2d-8df0-9b72507dda27';
  baita_delivery constant uuid := 'e0b23dce-3f4f-4d2a-bd30-eaa377dbba80';
  baita_edit_step constant uuid := 'f6c9580e-aa2f-486d-8937-88dbe52a6bcd';
  shared_from_meeting integer;
begin
  -- Only the links that are simultaneously owned by the dated Portal plan are
  -- retyped. Other future members of the recurring template are untouched.
  select count(*) into shared_from_meeting
  from public.task_links meeting_link
  join public.task_links portal_link on portal_link.child_id = meeting_link.child_id
  where meeting_link.parent_id = meeting_template
    and meeting_link.relation_kind = 'structural_member'
    and portal_link.parent_id = portal_occurrence
    and portal_link.relation_kind = 'structural_member';

  if shared_from_meeting <> 3 and not exists (
    select 1
    from public.task_links meeting_link
    join public.task_links portal_link on portal_link.child_id = meeting_link.child_id
    where meeting_link.parent_id = meeting_template
      and meeting_link.relation_kind = 'reference'
      and portal_link.parent_id = portal_occurrence
      and portal_link.relation_kind = 'structural_member'
  ) then
    raise exception 'Reviewed Reunião -> Portal shared links are not in the expected state (found % structural links)', shared_from_meeting;
  end if;

  if not exists (
    select 1 from public.tasks
    where id = portal_occurrence
      and plan_id = meeting_template
      and payload ->> 'recurrence_parent_id' = meeting_template::text
  ) then
    raise exception 'Portal occurrence is no longer linked to the reviewed Reunião recurrence';
  end if;

  if not exists (
    select 1 from public.task_links
    where parent_id = baita_delivery
      and child_id = baita_edit_step
      and relation_kind = 'workflow_step'
      and slot = 'edicao'
  ) then
    raise exception 'Reviewed Baita workflow edge is not present';
  end if;

  -- Reunião remains directly visible as context for the three deliveries, but
  -- Portal is their only owner. No rollup, status or deadline can now be
  -- inherited through the contextual line.
  update public.task_links meeting_link
     set relation_kind = 'reference', slot = null, position = 0
    from public.task_links portal_link
   where meeting_link.parent_id = meeting_template
     and meeting_link.child_id = portal_link.child_id
     and meeting_link.relation_kind = 'structural_member'
     and portal_link.parent_id = portal_occurrence
     and portal_link.relation_kind = 'structural_member';

  -- The monthly plan owns the Event delivery. The editing card remains the
  -- workflow step of that delivery; it must not be a direct plan member too.
  delete from public.task_links
   where parent_id = september_plan
     and child_id = baita_edit_step
     and relation_kind = 'structural_member';

  insert into public.task_links (parent_id, child_id, relation_kind, slot, position)
  values (september_plan, baita_delivery, 'structural_member', null, 0)
  on conflict (parent_id, child_id) do update
    set relation_kind = excluded.relation_kind,
        slot = excluded.slot,
        position = excluded.position;

  if exists (
    select 1
    from public.task_links
    where relation_kind = 'structural_member'
    group by child_id
    having count(*) > 1
  ) then
    raise exception 'Family reconciliation left a card with multiple structural parents';
  end if;
end;
$$;

-- A card has one structural location in the family tree. Workflow steps remain
-- deliberately N:N: the same filming-day task may feed several deliveries,
-- and each delivery rolls up that shared execution through its own named slot.
create unique index if not exists task_links_one_structural_parent_per_child_idx
  on public.task_links (child_id)
  where relation_kind = 'structural_member';

-- Phase 2 cutover: relation_kind is no longer derived from slot. The current
-- application writes it on every path; callers that omit it must fail loudly
-- instead of recreating an ambiguous legacy edge.
create or replace function public.validate_task_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_client_id uuid;
  child_client_id uuid;
  graph_kinds text[];
begin
  if new.relation_kind is null then
    raise exception 'task_links.relation_kind is required'
      using errcode = '23502';
  end if;

  if new.parent_id = new.child_id then
    raise exception 'A task cannot link to itself'
      using errcode = '23514';
  end if;

  if new.relation_kind not in ('structural_member', 'workflow_step', 'reference', 'dependency') then
    raise exception 'Unknown task link relation_kind: %', new.relation_kind
      using errcode = '23514';
  end if;

  if new.relation_kind = 'workflow_step'
     and (new.slot is null or btrim(new.slot) = '') then
    raise exception 'A workflow_step link requires a non-blank slot'
      using errcode = '23514';
  end if;

  if new.relation_kind <> 'workflow_step' and new.slot is not null then
    raise exception 'Only a workflow_step link may have a slot'
      using errcode = '23514';
  end if;

  select t.client_id into parent_client_id
    from public.tasks t where t.id = new.parent_id;
  if not found then
    raise exception 'Parent task % does not exist', new.parent_id
      using errcode = '23503';
  end if;

  select t.client_id into child_client_id
    from public.tasks t where t.id = new.child_id;
  if not found then
    raise exception 'Child task % does not exist', new.child_id
      using errcode = '23503';
  end if;

  if parent_client_id is distinct from child_client_id then
    raise exception 'Linked tasks must belong to the same client'
      using errcode = '23514';
  end if;

  -- References are contextual and may be reciprocal. Dependencies must be a
  -- DAG among themselves; structural/workflow paths form the operational DAG.
  if new.relation_kind = 'reference' then
    return new;
  end if;

  graph_kinds := case
    when new.relation_kind = 'dependency' then array['dependency']
    else array['structural_member', 'workflow_step']
  end;

  perform pg_advisory_xact_lock(hashtextextended('public.task_links.graph', 0));

  if exists (
    with recursive descendants(id) as (
      select l.child_id
      from public.task_links l
      where l.parent_id = new.child_id
        and l.relation_kind = any (graph_kinds)
      union
      select l.child_id
      from public.task_links l
      join descendants d on l.parent_id = d.id
      where l.relation_kind = any (graph_kinds)
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'Task link would create a % cycle', new.relation_kind
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_link on public.task_links;
create trigger validate_task_link
  before insert or update of parent_id, child_id, relation_kind, slot on public.task_links
  for each row execute function public.validate_task_link();
