begin;

-- These two legacy guards validate the old kind/subtype topology. The FK
-- catalog below replaces them before any task write can observe the new tree.
drop trigger if exists tasks_valida_vocabulario on public.tasks;
drop function if exists public.tasks_valida_vocabulario();
drop trigger if exists task_types_forbid_delivery_owned_subtypes on public.task_types;
drop function if exists public.task_type_cannot_belong_to_delivery();

-- Unifies Creative and Automation deliveries under one immutable, FK-backed
-- workflow engine. This migration is intentionally self-contained so it can
-- be applied through the direct Session-pooler runbook in one transaction.
--
-- Rollback before application cutover:
--   * restore task_links.slot from workflow_version_steps.step_key;
--   * restore report parents to kind=criativo and the four removed payload
--     compatibility keys from the preflight snapshot;
--   * drop the triggers/columns/tables introduced below;
--   * recreate task_type_workflow_steps from the published Creative version.
-- After new writes start, rollback is forward-only: publish a corrected
-- workflow version and keep existing deliveries on their pinned version.

-- -------------------------------------------------------------------------
-- 1. Canonical task subtypes used by Automation deliveries
-- -------------------------------------------------------------------------

do $$
declare
  common_type_id uuid;
  delivery_type_id uuid;
  creative_type_id uuid;
begin
  -- The FK catalog is canonical; legacy tasks.kind text remains only as an
  -- application projection during the cutover.
  select id into common_type_id from public.task_types
  where parent_id is null and key = 'operacional';
  if common_type_id is null then
    raise exception 'Legacy common Task root is missing';
  end if;
  update public.task_types
  set key = 'tarefa', label = 'Tarefa', behavior = 'simples', creatable = true
  where id = common_type_id;

  insert into public.task_types (
    parent_id, key, label, order_index, behavior, creatable, active,
    icon, tone, show_in_performance
  ) values (
    null, 'entrega', 'Entrega', 20, 'entrega', false, true,
    '✦', 'purple', false
  )
  on conflict (key) where parent_id is null do update set
    label = excluded.label, behavior = excluded.behavior,
    creatable = false, active = true
  returning id into delivery_type_id;

  select id into creative_type_id from public.task_types
  where parent_id is null and key = 'criativo';
  if creative_type_id is null then
    raise exception 'Legacy Creative root is missing';
  end if;
  update public.task_types
  set parent_id = delivery_type_id, label = 'Criativo', order_index = 10,
      behavior = 'entrega', creatable = true, active = true
  where id = creative_type_id;

  update public.task_types
  set key = 'plano', label = 'Plano', order_index = 30, behavior = 'plano'
  where parent_id is null and key = 'plano_acao';

  update public.task_types
  set key = 'checkpoint', label = 'Checkpoint', order_index = 40,
      behavior = 'simples', creatable = false
  where parent_id is null and key = 'checkpoint_comercial';

  insert into public.task_types (
    parent_id, key, label, order_index, behavior, creatable, active,
    lead_days, progress_weight, default_assignee, client_visible
  ) values
    (common_type_id, 'relatorio_anuncios', 'Relatório de anúncios', 100, 'simples', false, true, 0, 1, 'Northia', false),
    (common_type_id, 'feedback', 'Feedback', 110, 'simples', false, true, 2, 1, null, true),
    (common_type_id, 'relatorio_conversao', 'Relatório de conversão', 120, 'simples', false, true, 0, 1, 'Northia', false)
  on conflict (parent_id, key) do update set
    label = excluded.label,
    active = true,
    lead_days = excluded.lead_days,
    progress_weight = excluded.progress_weight,
    default_assignee = excluded.default_assignee,
    client_visible = excluded.client_visible;

  insert into public.task_types (
    parent_id, key, label, order_index, behavior, creatable, active,
    icon, tone, show_in_performance
  ) values (
    delivery_type_id, 'automacao', 'Automação', 20, 'entrega', false, true,
    '⚡', 'purple', false
  )
  on conflict (parent_id, key) do update set
    label = excluded.label,
    behavior = 'entrega',
    active = true,
    icon = excluded.icon,
    tone = excluded.tone;
end;
$$;

-- -------------------------------------------------------------------------
-- 2. Versioned workflow definitions
-- -------------------------------------------------------------------------

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  delivery_type_id uuid not null references public.task_types(id) on delete restrict,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  label text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (delivery_type_id, version),
  constraint workflow_versions_published_timestamp check (
    status <> 'published' or published_at is not null
  )
);

create unique index workflow_versions_one_published_per_delivery_idx
  on public.workflow_versions (delivery_type_id)
  where status = 'published';

create table public.workflow_version_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.workflow_versions(id) on delete cascade,
  task_type_id uuid not null references public.task_types(id) on delete restrict,
  step_key text not null check (step_key ~ '^[a-z0-9_]+$'),
  label text not null,
  order_index integer not null check (order_index >= 0),
  progress_weight numeric not null default 1 check (progress_weight > 0),
  lead_days integer not null default 0 check (lead_days >= 0),
  creation_trigger text not null default 'previous_step_approved'
    check (creation_trigger in ('delivery_created', 'ads_report_approved', 'feedback_approved', 'previous_step_approved')),
  default_assignee text,
  client_visible boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workflow_version_id, step_key),
  unique (workflow_version_id, order_index)
);

create index workflow_version_steps_type_idx
  on public.workflow_version_steps (task_type_id);

alter table public.workflow_versions enable row level security;
alter table public.workflow_version_steps enable row level security;

create policy "workflow versions admin read"
  on public.workflow_versions for select to authenticated
  using (true);
create policy "workflow versions admin write"
  on public.workflow_versions for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "workflow steps admin read"
  on public.workflow_version_steps for select to authenticated
  using (true);
create policy "workflow steps admin write"
  on public.workflow_version_steps for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.workflow_versions to authenticated, service_role;
grant select, insert, update, delete on public.workflow_version_steps to authenticated, service_role;

create or replace function public.workflow_definition_is_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  delivery_behavior text;
  task_parent_key text;
begin
  select behavior into delivery_behavior
  from public.task_types
  where id = (select delivery_type_id from public.workflow_versions where id = new.workflow_version_id);

  if delivery_behavior is distinct from 'entrega' then
    raise exception 'workflow version must belong to a Delivery type' using errcode = '23514';
  end if;

  select parent.key into task_parent_key
  from public.task_types step
  join public.task_types parent on parent.id = step.parent_id
  where step.id = new.task_type_id;

  if task_parent_key is distinct from 'tarefa' then
    raise exception 'workflow step must point to a common Task subtype' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger workflow_version_steps_validate
  before insert or update on public.workflow_version_steps
  for each row execute function public.workflow_definition_is_valid();

do $$
declare
  creative_type_id uuid;
  automation_type_id uuid;
  creative_version_id uuid;
  automation_version_id uuid;
begin
  select variant.id into creative_type_id
  from public.task_types variant
  join public.task_types parent on parent.id = variant.parent_id
  where parent.key = 'entrega' and variant.key = 'criativo';
  select variant.id into automation_type_id
  from public.task_types variant
  join public.task_types parent on parent.id = variant.parent_id
  where parent.key = 'entrega' and variant.key = 'automacao';

  insert into public.workflow_versions (delivery_type_id, version, status, label, published_at)
  values (creative_type_id, 1, 'published', 'Criativo v1', now())
  returning id into creative_version_id;

  insert into public.workflow_version_steps (
    workflow_version_id, task_type_id, step_key, label, order_index,
    progress_weight, lead_days, creation_trigger, default_assignee, client_visible
  )
  select
    creative_version_id,
    mapping.task_subtype_id,
    subtype.key,
    subtype.label,
    mapping.order_index,
    subtype.progress_weight,
    subtype.lead_days,
    case when row_number() over (order by mapping.order_index) = 1
      then 'delivery_created' else 'previous_step_approved' end,
    subtype.default_assignee,
    subtype.client_visible
  from public.task_type_workflow_steps mapping
  join public.task_types subtype on subtype.id = mapping.task_subtype_id
  where mapping.delivery_type_id = creative_type_id
  order by mapping.order_index;

  if not exists (
    select 1 from public.workflow_version_steps where workflow_version_id = creative_version_id
  ) then
    raise exception 'Creative workflow has no declared steps';
  end if;

  insert into public.workflow_versions (delivery_type_id, version, status, label, published_at)
  values (automation_type_id, 1, 'published', 'Automação v1', now())
  returning id into automation_version_id;

  insert into public.workflow_version_steps (
    workflow_version_id, task_type_id, step_key, label, order_index,
    progress_weight, lead_days, creation_trigger, default_assignee, client_visible
  )
  select automation_version_id, subtype.id, definition.step_key, definition.label,
         definition.order_index, 1, definition.lead_days,
         definition.creation_trigger, definition.default_assignee, definition.client_visible
  from (values
    ('relatorio_anuncios', 'Relatório de anúncios', 10, 0, 'delivery_created', 'Northia', false),
    ('feedback', 'Feedback', 20, 2, 'ads_report_approved', null, true),
    ('relatorio_conversao', 'Relatório de conversão', 30, 0, 'feedback_approved', 'Northia', false)
  ) as definition(step_key, label, order_index, lead_days, creation_trigger, default_assignee, client_visible)
  join public.task_types subtype
    on subtype.parent_id = (select id from public.task_types where parent_id is null and key = 'tarefa')
   and subtype.key = definition.step_key;
end;
$$;

create or replace function public.workflow_version_step_is_mutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  version_status text;
begin
  select status into version_status
  from public.workflow_versions
  where id = coalesce(new.workflow_version_id, old.workflow_version_id);
  if version_status is distinct from 'draft' then
    raise exception 'Published workflow steps are immutable; create a new version' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger workflow_version_steps_immutable
  before insert or update or delete on public.workflow_version_steps
  for each row execute function public.workflow_version_step_is_mutable();

create or replace function public.workflow_version_transition_is_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'Published workflow versions cannot be deleted' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    if new.status <> 'retired'
       or new.delivery_type_id is distinct from old.delivery_type_id
       or new.version is distinct from old.version
       or new.label is distinct from old.label
       or new.published_at is distinct from old.published_at then
      raise exception 'Published workflow versions are immutable; only retirement is allowed' using errcode = '23514';
    end if;
  end if;
  if new.status = 'published' and not exists (
    select 1 from public.workflow_version_steps where workflow_version_id = new.id
  ) then
    raise exception 'A workflow cannot be published without steps' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger workflow_versions_immutable
  before update or delete on public.workflow_versions
  for each row execute function public.workflow_version_transition_is_valid();

-- -------------------------------------------------------------------------
-- 3. Pin task instances and links to definitions
-- -------------------------------------------------------------------------

alter table public.tasks
  add column task_type_id uuid references public.task_types(id) on delete restrict,
  add column workflow_version_id uuid references public.workflow_versions(id) on delete restrict,
  add column workflow_activated_at timestamptz;

alter table public.task_links
  add column workflow_step_id uuid references public.workflow_version_steps(id) on delete restrict;

-- Report deliveries are no longer disguised as Creative deliveries.
update public.tasks
set kind = 'automacao', subtype = null
where payload->>'automation_flow' = 'report_conversion';

-- Normalize the one already materialized report child, if present.
update public.tasks child
set subtype = case child.subtype
  when 'trafego' then 'relatorio_anuncios'
  when 'conversao' then 'relatorio_conversao'
  else child.subtype
end
where exists (
  select 1
  from public.task_links link
  join public.tasks parent on parent.id = link.parent_id
  where link.child_id = child.id
    and link.relation_kind = 'workflow_step'
    and parent.kind = 'automacao'
);

update public.task_links link
set slot = case link.slot
  when 'trafego' then 'relatorio_anuncios'
  when 'conversao' then 'relatorio_conversao'
  else link.slot
end
where relation_kind = 'workflow_step'
  and exists (select 1 from public.tasks parent where parent.id = link.parent_id and parent.kind = 'automacao');

-- FK classification becomes authoritative. kind/subtype remain a read
-- projection during the broad application migration, never workflow input.
update public.tasks task
set task_type_id = subtype_type.id
from public.task_types subtype_type
join public.task_types root_type on root_type.id = subtype_type.parent_id
where task.task_type_id is null
  and task.kind = 'operacional'
  and task.subtype is not null
  and root_type.key = 'tarefa'
  and subtype_type.key = case task.subtype
    when 'trafego' then 'relatorio_anuncios'
    when 'conversao' then 'relatorio_conversao'
    else task.subtype
  end;

update public.tasks task
set task_type_id = root_type.id
from public.task_types root_type
where task.task_type_id is null
  and task.kind = 'operacional'
  and task.subtype is null
  and root_type.parent_id is null
  and root_type.key = 'tarefa';

update public.tasks task
set task_type_id = variant.id
from public.task_types variant
join public.task_types root_type on root_type.id = variant.parent_id
where task.task_type_id is null
  and root_type.key = 'entrega'
  and variant.key = task.kind
  and task.kind in ('criativo', 'automacao');

update public.tasks task
set task_type_id = root_type.id
from public.task_types root_type
where task.task_type_id is null
  and root_type.parent_id is null
  and root_type.key = case task.kind
    when 'plano_acao' then 'plano'
    when 'checkpoint_comercial' then 'checkpoint'
    else null
  end;

do $$
begin
  if exists (select 1 from public.tasks where task_type_id is null) then
    raise exception 'Some tasks could not be classified by task_type_id';
  end if;
end;
$$;

alter table public.tasks alter column task_type_id set not null;
create index tasks_task_type_id_idx on public.tasks (task_type_id);
create index tasks_workflow_version_id_idx on public.tasks (workflow_version_id)
  where workflow_version_id is not null;

create or replace function public.tasks_project_task_type()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  type_key text;
  parent_key text;
begin
  select current_type.key, parent.key
    into type_key, parent_key
  from public.task_types current_type
  left join public.task_types parent on parent.id = current_type.parent_id
  where current_type.id = new.task_type_id;

  if type_key is null then
    raise exception 'Unknown task_type_id' using errcode = '23503';
  elsif parent_key = 'tarefa' then
    new.kind := 'operacional';
    new.subtype := type_key;
  elsif type_key = 'tarefa' and parent_key is null then
    new.kind := 'operacional';
    new.subtype := null;
  elsif parent_key = 'entrega' then
    new.kind := type_key;
    new.subtype := null;
  elsif type_key = 'plano' and parent_key is null then
    new.kind := 'plano_acao';
    new.subtype := null;
  elsif type_key = 'checkpoint' and parent_key is null then
    new.kind := 'checkpoint_comercial';
    new.subtype := null;
  else
    raise exception 'task_type_id does not represent an executable classification' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tasks_project_task_type
  before insert or update of task_type_id, kind, subtype on public.tasks
  for each row execute function public.tasks_project_task_type();

update public.tasks delivery
set workflow_version_id = version.id,
    workflow_activated_at = case
      when exists (
        select 1 from public.task_links link
        join public.tasks child on child.id = link.child_id
        where link.parent_id = delivery.id
          and link.relation_kind = 'workflow_step'
          and child.status <> 'backlog'
      ) then coalesce(delivery.created_at, now())
      else null
    end
from public.workflow_versions version
join public.task_types delivery_type on delivery_type.id = version.delivery_type_id
where version.status = 'published'
  and delivery.kind = delivery_type.key
  and (
    exists (select 1 from public.task_links link where link.parent_id = delivery.id and link.relation_kind = 'workflow_step')
    or delivery.kind = 'automacao'
    or coalesce(delivery.payload->>'flow_parent', 'false') = 'true'
  );

update public.task_links link
set workflow_step_id = step.id,
    slot = step.step_key,
    position = step.order_index
from public.tasks parent
join public.workflow_version_steps step
  on step.workflow_version_id = parent.workflow_version_id
where parent.id = link.parent_id
  and link.relation_kind = 'workflow_step'
  and step.step_key = link.slot;

do $$
begin
  if exists (
    select 1 from public.task_links
    where relation_kind = 'workflow_step' and workflow_step_id is null
  ) then
    raise exception 'A workflow link could not be mapped to its pinned version';
  end if;
end;
$$;

create unique index task_links_parent_workflow_step_idx
  on public.task_links (parent_id, workflow_step_id)
  where relation_kind = 'workflow_step';

create or replace function public.task_link_matches_workflow_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_version_id uuid;
  step_version_id uuid;
  expected_task_type_id uuid;
  actual_task_type_id uuid;
  canonical_step_key text;
  canonical_order integer;
begin
  if new.relation_kind <> 'workflow_step' then
    if new.workflow_step_id is not null then
      raise exception 'Only workflow_step links may carry workflow_step_id' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.workflow_step_id is null then
    raise exception 'workflow_step_id is required for workflow links' using errcode = '23514';
  end if;

  select workflow_version_id into parent_version_id from public.tasks where id = new.parent_id;
  select workflow_version_id, task_type_id, step_key, order_index
    into step_version_id, expected_task_type_id, canonical_step_key, canonical_order
  from public.workflow_version_steps where id = new.workflow_step_id;
  select task_type_id into actual_task_type_id from public.tasks where id = new.child_id;

  if parent_version_id is null or parent_version_id is distinct from step_version_id then
    raise exception 'workflow step does not belong to the Delivery pinned version' using errcode = '23514';
  end if;
  if actual_task_type_id is distinct from expected_task_type_id then
    raise exception 'workflow child has an incompatible Task subtype' using errcode = '23514';
  end if;

  -- slot/position survive only as denormalized projections for old clients.
  new.slot := canonical_step_key;
  new.position := canonical_order;
  return new;
end;
$$;

create trigger task_links_validate_workflow_version
  before insert or update on public.task_links
  for each row execute function public.task_link_matches_workflow_version();

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

create constraint trigger tasks_delivery_workflow_consistent
  after insert or update of status, workflow_version_id, workflow_activated_at on public.tasks
  deferrable initially deferred
  for each row execute function public.delivery_workflow_is_consistent();

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

create trigger tasks_lock_delivery_classification
  before update of task_type_id, workflow_version_id on public.tasks
  for each row execute function public.delivery_classification_is_mutable();

create or replace function public.workflow_task_uuid(p_parent_id uuid, p_identity text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  raw_hex text;
  variant_nibble text;
begin
  raw_hex := substr(encode(extensions.digest(p_parent_id::text || ':' || p_identity, 'sha256'), 'hex'), 1, 32);
  variant_nibble := to_hex(((get_byte(decode(substr(raw_hex, 17, 2), 'hex'), 0) >> 4) & 3) | 8);
  raw_hex := overlay(raw_hex placing '5' from 13 for 1);
  raw_hex := overlay(raw_hex placing variant_nibble from 17 for 1);
  return (
    substr(raw_hex, 1, 8) || '-' || substr(raw_hex, 9, 4) || '-' ||
    substr(raw_hex, 13, 4) || '-' || substr(raw_hex, 17, 4) || '-' ||
    substr(raw_hex, 21, 12)
  )::uuid;
end;
$$;

revoke all on function public.workflow_task_uuid(uuid, text) from public, anon, authenticated;
grant execute on function public.workflow_task_uuid(uuid, text) to service_role;

create or replace function public.ensure_delivery_first_step(p_delivery_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.tasks;
  first_step public.workflow_version_steps;
  first_task_id uuid;
  base_date date;
begin
  select * into delivery from public.tasks where id = p_delivery_id;
  if delivery.id is null or delivery.workflow_version_id is null
     or coalesce(delivery.payload->>'recurrence_group', 'false') = 'true' then
    return null;
  end if;

  select * into first_step
  from public.workflow_version_steps
  where workflow_version_id = delivery.workflow_version_id
  order by order_index
  limit 1;
  if first_step.id is null then
    raise exception 'The selected workflow version has no first step' using errcode = '23514';
  end if;

  select link.child_id into first_task_id
  from public.task_links link
  where link.parent_id = delivery.id
    and link.relation_kind = 'workflow_step'
    and link.workflow_step_id = first_step.id
  limit 1;
  if first_task_id is not null then
    return first_task_id;
  end if;

  first_task_id := public.workflow_task_uuid(delivery.id, 'flow-step:' || first_step.step_key);
  base_date := coalesce(delivery.start_date, delivery.due_date, current_date);
  insert into public.tasks (
    id, client_id, title, status, priority, assignee, due_date, description,
    client_visible, payload, position, reviewer_id, kind, subtype,
    requires_review, requires_approval, start_date, end_date, progress_weight,
    approver_id, recurrence_cadence, recurrence_weekdays,
    recurrence_day_of_month, created_by, task_type_id
  ) values (
    first_task_id, delivery.client_id, delivery.title || ' — ' || first_step.label,
    'backlog', delivery.priority, coalesce(first_step.default_assignee, delivery.assignee),
    base_date + first_step.lead_days, null, first_step.client_visible,
    '{}'::jsonb, first_step.order_index, delivery.reviewer_id,
    'operacional', first_step.step_key, delivery.requires_review,
    delivery.requires_approval, base_date, base_date + first_step.lead_days,
    first_step.progress_weight, delivery.approver_id, null, '{}'::smallint[], null,
    delivery.created_by, first_step.task_type_id
  ) on conflict (id) do nothing;

  insert into public.task_links (
    parent_id, child_id, relation_kind, workflow_step_id, slot, position
  ) values (
    delivery.id, first_task_id, 'workflow_step', first_step.id,
    first_step.step_key, first_step.order_index
  ) on conflict (parent_id, child_id) do update set
    relation_kind = excluded.relation_kind,
    workflow_step_id = excluded.workflow_step_id,
    slot = excluded.slot,
    position = excluded.position;
  return first_task_id;
end;
$$;

revoke all on function public.ensure_delivery_first_step(uuid) from public, anon, authenticated;
grant execute on function public.ensure_delivery_first_step(uuid) to service_role;

create or replace function public.delivery_materializes_first_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_delivery_first_step(new.id);
  return new;
end;
$$;

revoke all on function public.delivery_materializes_first_step() from public, anon, authenticated;

create trigger tasks_materialize_first_workflow_step
  after insert on public.tasks
  for each row
  when (new.workflow_version_id is not null)
  execute function public.delivery_materializes_first_step();

create or replace function public.reconcile_delivery_workflow_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_link record;
  replacement_step_id uuid;
  automatic_empty boolean;
begin
  if new.workflow_version_id is not distinct from old.workflow_version_id then
    return new;
  end if;
  if new.workflow_version_id is null then
    raise exception 'A Delivery requires a workflow version' using errcode = '23514';
  end if;

  for existing_link in
    select link.parent_id, link.child_id, link.workflow_step_id,
           old_step.step_key, child.task_type_id, child.status, child.payload
    from public.task_links link
    join public.workflow_version_steps old_step on old_step.id = link.workflow_step_id
    join public.tasks child on child.id = link.child_id
    where link.parent_id = new.id and link.relation_kind = 'workflow_step'
  loop
    automatic_empty :=
      existing_link.child_id = public.workflow_task_uuid(new.id, 'flow-step:' || existing_link.step_key)
      and existing_link.status = 'backlog'
      and coalesce(existing_link.payload->'comments', '[]'::jsonb) = '[]'::jsonb
      and not exists (select 1 from public.documents where task_id = existing_link.child_id)
      and not exists (select 1 from public.traffic_reports where task_id = existing_link.child_id)
      and not exists (
        select 1 from public.task_links other
        where other.child_id = existing_link.child_id and other.parent_id <> new.id
      );

    if automatic_empty then
      delete from public.tasks where id = existing_link.child_id;
      continue;
    end if;

    select step.id into replacement_step_id
    from public.workflow_version_steps step
    where step.workflow_version_id = new.workflow_version_id
      and step.task_type_id = existing_link.task_type_id
      and not exists (
        select 1 from public.task_links occupied
        where occupied.parent_id = new.id
          and occupied.relation_kind = 'workflow_step'
          and occupied.workflow_step_id = step.id
      )
    order by step.order_index
    limit 1;

    if replacement_step_id is null then
      update public.task_links
      set relation_kind = 'reference', workflow_step_id = null, slot = null
      where parent_id = new.id and child_id = existing_link.child_id;
    else
      update public.task_links
      set workflow_step_id = replacement_step_id
      where parent_id = new.id and child_id = existing_link.child_id;
    end if;
  end loop;

  perform public.ensure_delivery_first_step(new.id);
  return new;
end;
$$;

revoke all on function public.reconcile_delivery_workflow_version() from public, anon, authenticated;

create trigger tasks_reconcile_delivery_workflow_version
  after update of workflow_version_id on public.tasks
  for each row execute function public.reconcile_delivery_workflow_version();

-- -------------------------------------------------------------------------
-- 4. Durable, idempotent automation execution ledger
-- -------------------------------------------------------------------------

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.automation_configs(id) on delete cascade,
  occurrence_id uuid references public.tasks(id) on delete set null,
  occurrence_key text not null,
  scheduled_for timestamptz not null,
  action text not null check (action in ('ads_report', 'conversion_report', 'materialize_next')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (config_id, occurrence_key, action),
  constraint automation_runs_state_shape check (
    (status = 'pending' and started_at is null and finished_at is null)
    or (status = 'running' and started_at is not null and finished_at is null)
    or (status in ('succeeded', 'failed') and started_at is not null and finished_at is not null)
  )
);

create index automation_runs_retry_idx
  on public.automation_runs (status, scheduled_for)
  where status in ('pending', 'failed');

alter table public.automation_configs
  drop column if exists last_run_date;

create trigger set_updated_at before update on public.automation_runs
  for each row execute function public.set_updated_at();

alter table public.automation_runs enable row level security;
create policy "automation runs admin read"
  on public.automation_runs for select to authenticated
  using ((select public.is_admin()));
create policy "automation runs admin write"
  on public.automation_runs for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
grant select, insert, update, delete on public.automation_runs to authenticated, service_role;

create or replace function public.claim_automation_run(
  p_config_id uuid,
  p_occurrence_key text,
  p_scheduled_for timestamptz,
  p_action text,
  p_occurrence_id uuid default null
)
returns setof public.automation_runs
language sql
security invoker
set search_path = ''
as $$
  insert into public.automation_runs (
    config_id, occurrence_id, occurrence_key, scheduled_for, action, status, attempts,
    started_at, finished_at, last_error
  ) values (
    p_config_id, p_occurrence_id, p_occurrence_key, p_scheduled_for, p_action, 'running', 1,
    now(), null, null
  )
  on conflict (config_id, occurrence_key, action) do update
    set occurrence_id = coalesce(excluded.occurrence_id, automation_runs.occurrence_id),
        status = 'running',
        attempts = automation_runs.attempts + 1,
        started_at = now(),
        finished_at = null,
        last_error = null
  where automation_runs.status in ('pending', 'failed')
     or (automation_runs.status = 'running' and automation_runs.started_at < now() - interval '15 minutes')
  returning automation_runs.*;
$$;

revoke all on function public.claim_automation_run(uuid, text, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_automation_run(uuid, text, timestamptz, text, uuid) to service_role;

create or replace function public.automation_dependency_is_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  own_client uuid;
  dependency_client uuid;
  dependency_key text;
begin
  if new.automation_key <> 'relatorio_vendas' then
    if new.depends_on_config_id is not null then
      raise exception 'Only conversion automation may declare a dependency' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.depends_on_config_id is null then
    raise exception 'Conversion automation requires an ads automation dependency' using errcode = '23514';
  end if;

  select target.client_id into own_client
  from public.tasks target where target.id = new.target_task_id;
  select dependency.automation_key, target.client_id
    into dependency_key, dependency_client
  from public.automation_configs dependency
  join public.tasks target on target.id = dependency.target_task_id
  where dependency.id = new.depends_on_config_id;

  if dependency_key is distinct from 'relatorio_trafego_semanal'
     or own_client is distinct from dependency_client then
    raise exception 'Conversion dependency must be the ads automation for the same client' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger automation_configs_validate_dependency
  before insert or update of automation_key, target_task_id, depends_on_config_id on public.automation_configs
  for each row execute function public.automation_dependency_is_valid();

create or replace function public.create_automation_config_with_dependency(
  p_automation_key text,
  p_target_task_id uuid,
  p_performance_template_id text,
  p_active boolean,
  p_collect_metric_keys text[],
  p_created_by uuid
)
returns setof public.automation_configs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  dependency_id uuid;
  ads_target_id uuid;
  ads_task_type_id uuid;
  target public.tasks;
  created public.automation_configs;
begin
  if p_automation_key = 'relatorio_vendas' then
    select * into target from public.tasks where id = p_target_task_id;
    if target.id is null or target.workflow_version_id is null or target.recurrence_cadence is null then
      raise exception 'Conversion automation requires a recurring Automation Delivery target' using errcode = '23514';
    end if;

    select config.id into dependency_id
    from public.automation_configs config
    join public.tasks ads_target on ads_target.id = config.target_task_id
    where config.automation_key = 'relatorio_trafego_semanal'
      and ads_target.client_id is not distinct from target.client_id
    order by config.active desc, config.created_at
    limit 1;

    if dependency_id is null then
      select subtype.id into ads_task_type_id
      from public.task_types subtype
      join public.task_types parent on parent.id = subtype.parent_id
      where parent.key = 'tarefa' and subtype.key = 'relatorio_anuncios';
      if ads_task_type_id is null then
        raise exception 'Ads report Task subtype is missing' using errcode = '23514';
      end if;

      ads_target_id := gen_random_uuid();
      insert into public.tasks (
        id, client_id, title, status, priority, assignee, due_date,
        client_visible, payload, position, reviewer_id, kind, subtype,
        requires_review, requires_approval, start_date, end_date,
        progress_weight, approver_id, recurrence_cadence,
        recurrence_weekdays, recurrence_day_of_month, created_by, task_type_id
      ) values (
        ads_target_id, target.client_id, 'RelatÃ³rio de anÃºncios', 'backlog',
        target.priority, 'Northia', coalesce(target.start_date, target.due_date), false,
        jsonb_build_object('recurrence_group', true, 'recurrence_cycle', 0, 'recurrence_revision', 0),
        target.position, target.reviewer_id, 'operacional', 'relatorio_anuncios',
        true, false, coalesce(target.start_date, target.due_date), target.end_date, 1, target.approver_id,
        target.recurrence_cadence, target.recurrence_weekdays,
        target.recurrence_day_of_month, p_created_by, ads_task_type_id
      );

      insert into public.automation_configs (
        automation_key, target_task_id, performance_template_id, active, created_by
      ) values (
        'relatorio_trafego_semanal', ads_target_id, p_performance_template_id,
        true, p_created_by
      ) returning id into dependency_id;
    else
      update public.automation_configs set active = true where id = dependency_id;
    end if;
  end if;

  insert into public.automation_configs (
    automation_key, target_task_id, performance_template_id, active,
    collect_metric_keys, depends_on_config_id, created_by
  ) values (
    p_automation_key, p_target_task_id, p_performance_template_id,
    coalesce(p_active, true), p_collect_metric_keys, dependency_id, p_created_by
  )
  returning * into created;

  return next created;
end;
$$;

revoke all on function public.create_automation_config_with_dependency(text, uuid, text, boolean, text[], uuid) from public, anon;
grant execute on function public.create_automation_config_with_dependency(text, uuid, text, boolean, text[], uuid) to authenticated, service_role;

-- pg_cron is UTC. 11:00 UTC is 08:00 America/Sao_Paulo in the canonical
-- operation timezone used by this product.
do $$
declare
  automation_job record;
begin
  for automation_job in
    select jobid from cron.job where jobname = 'automations-run-daily'
  loop
    perform cron.alter_job(automation_job.jobid, schedule := '0 11 * * *');
  end loop;
end;
$$;

-- The old workflow definition table has been fully copied into version 1.
drop table public.task_type_workflow_steps;
drop function if exists public.task_type_workflow_step_is_valid();

-- Structural behavior no longer comes from payload flags.
update public.tasks
set payload = payload
  - 'flow_parent'
  - 'automation_flow'
  - 'flow_step_count'
  - 'flow_total_weight'
  - 'flow_step_key'
where payload ?| array['flow_parent', 'automation_flow', 'flow_step_count', 'flow_total_weight', 'flow_step_key'];

-- Obsolete report vocabulary is safe to remove after every report child was
-- normalized above. There are no legitimate task rows using these keys.
delete from public.task_types
where parent_id = (select id from public.task_types where parent_id is null and key = 'tarefa')
  and key in ('relatorio_trafego', 'trafego', 'conversao');

delete from public.task_types
where parent_id is null
  and key = 'relatorio_conversao';

create or replace function public.task_type_has_canonical_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_key text;
begin
  if new.parent_id is null then
    if new.key not in ('tarefa', 'entrega', 'plano', 'checkpoint') then
      raise exception 'Invalid structural task type root' using errcode = '23514';
    end if;
    return new;
  end if;

  select key into parent_key from public.task_types where id = new.parent_id;
  if parent_key = 'tarefa' and new.behavior <> 'simples' then
    raise exception 'Task subtypes must be executable simple tasks' using errcode = '23514';
  elsif parent_key = 'entrega' and new.behavior <> 'entrega' then
    raise exception 'Delivery variants must use Delivery behavior' using errcode = '23514';
  elsif parent_key not in ('tarefa', 'entrega') then
    raise exception 'Only Task and Delivery may own subtype rows' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger task_types_canonical_parent
  before insert or update of parent_id, key, behavior on public.task_types
  for each row execute function public.task_type_has_canonical_parent();

do $$
begin
  if exists (select 1 from public.tasks where task_type_id is null) then
    raise exception 'Postcondition failed: task without task_type_id';
  end if;
  if exists (
    select 1 from public.task_links
    where relation_kind = 'workflow_step' and workflow_step_id is null
  ) then
    raise exception 'Postcondition failed: workflow link without workflow_step_id';
  end if;
  if exists (
    select 1 from public.tasks
    where payload ?| array['flow_parent', 'automation_flow', 'flow_step_count', 'flow_total_weight', 'flow_step_key']
  ) then
    raise exception 'Postcondition failed: legacy structural payload flag remains';
  end if;
  if exists (
    select 1 from public.task_types
    where (parent_id is null and key not in ('tarefa', 'entrega', 'plano', 'checkpoint'))
       or key in ('operacional', 'relatorio_trafego', 'trafego', 'conversao')
  ) then
    raise exception 'Postcondition failed: legacy physical task type remains';
  end if;
end;
$$;

-- Transaction intentionally remains open for the allowlisted reconciliation
-- migration that follows in the production runbook.
