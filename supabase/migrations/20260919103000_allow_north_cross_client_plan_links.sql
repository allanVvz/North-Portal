-- ADM North plans are agency-wide containers and may contain cards from
-- different clients. All other task links remain tenant-local.
create or replace function public.validate_task_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_client_id uuid;
  child_client_id uuid;
  graph_kinds text[];
  parent_is_north_plan boolean;
begin
  if new.relation_kind is null then
    new.relation_kind := case
      when new.slot is null then 'structural_member'
      else 'workflow_step'
    end;
  end if;

  if new.relation_kind not in ('structural_member', 'workflow_step', 'reference', 'dependency') then
    raise exception 'Unknown task link relation_kind: %', new.relation_kind using errcode = '23514';
  end if;
  if new.relation_kind = 'workflow_step' and (new.slot is null or btrim(new.slot) = '') then
    raise exception 'A workflow_step link requires a non-blank slot' using errcode = '23514';
  end if;
  if new.relation_kind <> 'workflow_step' and new.slot is not null then
    raise exception 'Only a workflow_step link may have a slot' using errcode = '23514';
  end if;

  select t.client_id into parent_client_id from public.tasks t where t.id = new.parent_id;
  if not found then raise exception 'Parent task % does not exist', new.parent_id using errcode = '23503'; end if;
  select t.client_id into child_client_id from public.tasks t where t.id = new.child_id;
  if not found then raise exception 'Child task % does not exist', new.child_id using errcode = '23503'; end if;

  select exists (
    select 1 from public.tasks p join public.clients c on c.id = p.client_id
    where p.id = new.parent_id and p.kind = 'plano_acao' and c.slug = 'north'
  ) into parent_is_north_plan;

  if parent_client_id is distinct from child_client_id
     and not (new.relation_kind = 'structural_member' and parent_is_north_plan) then
    raise exception 'Linked tasks must belong to the same client' using errcode = '23514';
  end if;

  if new.relation_kind = 'reference' then return new; end if;
  graph_kinds := case when new.relation_kind = 'dependency' then array['dependency'] else array['structural_member', 'workflow_step'] end;
  perform pg_advisory_xact_lock(hashtextextended('public.task_links.graph', 0));
  if exists (
    with recursive descendants(id) as (
      select l.child_id from public.task_links l where l.parent_id = new.child_id and l.relation_kind = any (graph_kinds)
      union
      select l.child_id from public.task_links l join descendants d on l.parent_id = d.id where l.relation_kind = any (graph_kinds)
    ) select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'Task link would create a % cycle', new.relation_kind using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_task_link on public.task_links;
create trigger validate_task_link
  before insert or update of parent_id, child_id, relation_kind, slot on public.task_links
  for each row execute function public.validate_task_link();
