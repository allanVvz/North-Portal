-- Phase 1: make the meaning of a task edge explicit without changing the
-- current task API or deleting/re-parenting any card.
--
-- The former convention was implicit: slot IS NULL meant plan membership and
-- slot IS NOT NULL meant a delivery step.  That cannot represent a canonical
-- family, a reusable reference and a dependency as distinct concepts.  The
-- explicit kind below is the compatibility bridge for the relation model:
--
--   structural_member  canonical family containment (one parent per child is
--                      deliberately NOT enforced yet; see preflight query).
--   workflow_step      ordered, named step of a workflow.
--   reference          contextual N:N reuse; never contributes to rollup.
--   dependency         N:N blocking relation; never contributes to rollup.
--
-- No production application code has been switched to write relation_kind in
-- this phase.  The trigger derives it from the old slot convention only for
-- those old writers, so every persisted edge is explicit while rollout stays
-- backwards compatible.  A subsequent code migration must send
-- relation_kind explicitly and may remove that compatibility branch.

-- Preflight only rejects data that cannot be assigned a safe meaning.  It
-- intentionally does not reject cards with multiple current parents: those
-- require a product decision/reconciliation, not an arbitrary migration.
do $$
begin
  if exists (
    select 1
    from public.task_links
    where slot is not null
      and btrim(slot) = ''
  ) then
    raise exception
      'task_links contains blank workflow slots; reconcile them before adding relation_kind';
  end if;
end;
$$;

alter table public.task_links
  add column if not exists relation_kind text;

-- Backfill is non-destructive and deterministic from the legacy encoding.
-- Keep this UPDATE separate from the NOT NULL constraint so a failed
-- preflight leaves the existing shape untouched.
update public.task_links
set relation_kind = case
  when slot is null then 'structural_member'
  else 'workflow_step'
end
where relation_kind is null;

alter table public.task_links
  alter column relation_kind set not null;

alter table public.task_links
  drop constraint if exists task_links_relation_kind_valid,
  add constraint task_links_relation_kind_valid
    check (relation_kind in ('structural_member', 'workflow_step', 'reference', 'dependency')),
  drop constraint if exists task_links_relation_slot_shape,
  add constraint task_links_relation_slot_shape
    check (
      (relation_kind = 'workflow_step' and slot is not null and btrim(slot) <> '')
      or
      (relation_kind <> 'workflow_step' and slot is null)
    );

-- Read paths always start from a card and select a relation role, then walk to
-- its parent.  This index keeps canonical-family, workflow and contextual
-- relation queries narrow without replacing the existing parent-order index.
create index if not exists task_links_child_relation_parent_idx
  on public.task_links (child_id, relation_kind, parent_id);

create index if not exists task_links_parent_relation_position_idx
  on public.task_links (parent_id, relation_kind, position, child_id);

-- The old graph guard is upgraded so that only family/workflow edges define
-- family ancestry.  References may be reciprocal. Dependencies must remain a
-- DAG among themselves, but cannot accidentally become family containment.
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
  -- Compatibility for callers not yet migrated to the explicit API.  New
  -- callers should always supply relation_kind.
  if new.relation_kind is null then
    new.relation_kind := case
      when new.slot is null then 'structural_member'
      else 'workflow_step'
    end;
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

-- Phase-2 preflight: this query identifies the rows that must be reconciled
-- before adding the partial unique index that makes family membership exactly
-- one-parent.  Do not pick a winner in SQL: shared cards must become explicit
-- references or dependencies through a reviewed data migration.
--
-- select child_id, array_agg(parent_id order by parent_id) as parent_ids
-- from public.task_links
-- where relation_kind in ('structural_member', 'workflow_step')
-- group by child_id
-- having count(*) > 1;
