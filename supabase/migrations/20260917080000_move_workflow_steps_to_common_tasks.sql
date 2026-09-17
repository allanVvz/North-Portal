-- Workflow role belongs to task_links.workflow_step.  A card that performs a
-- role is an ordinary Task whose subtype describes the work (roteiro,
-- captação, edição, publicação), never an Entrega itself.

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

  -- Preserve one canonical subtype row per key under Tarefa. Rows duplicated
  -- under an old Delivery parent are retired after their cards are moved.
  insert into public.task_types (
    parent_id, key, label, order_index, behavior, creatable, active,
    lead_days, progress_weight, default_assignee, client_visible
  )
  select common_type_id, s.key, s.label, s.order_index, 'simples', s.creatable,
         s.active, s.lead_days, s.progress_weight, s.default_assignee, s.client_visible
    from public.task_types s
    join public.task_types parent on parent.id = s.parent_id
   where parent.parent_id is null
     and parent.behavior = 'entrega'
  on conflict (parent_id, key) do nothing;

  -- Every existing card that used a Delivery subtype is an execution step.
  -- Flow parents have no subtype and remain Entregas.
  update public.tasks t
     set kind = 'operacional'
    from public.task_types old_step
    join public.task_types old_parent on old_parent.id = old_step.parent_id
   where t.kind = old_parent.key
     and t.subtype = old_step.key
     and old_parent.parent_id is null
     and old_parent.behavior = 'entrega';

  -- Retire the old duplicated vocabulary. Keeping inactive rows preserves the
  -- migration history while making future writes impossible through it.
  update public.task_types s
     set active = false
    from public.task_types parent
   where s.parent_id = parent.id
     and parent.parent_id is null
     and parent.behavior = 'entrega';

  if exists (
    select 1
      from public.tasks t
      join public.task_links l on l.child_id = t.id
     where l.relation_kind = 'workflow_step'
       and (t.kind <> 'operacional' or t.subtype is null)
  ) then
    raise exception 'Workflow steps must be common Tasks after migration';
  end if;
end;
$$;
