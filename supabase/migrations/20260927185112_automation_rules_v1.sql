begin;

-- Published definitions are separate from the 13 card-bound legacy configs.
-- Existing automation_configs and their daily_config values are untouched.
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default false,
  current_version_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete restrict,
  version integer not null check (version > 0),
  source_type_id uuid not null references public.task_types(id) on delete restrict,
  source_subtype_id uuid references public.task_types(id) on delete restrict,
  workflow_version_id uuid references public.workflow_versions(id) on delete restrict,
  workflow_step_id uuid references public.workflow_version_steps(id) on delete restrict,
  trigger_kind text not null check (trigger_kind in ('status_transition', 'recurrence_occurrence')),
  from_status text,
  to_status text,
  action_kind text not null check (action_kind in ('create_card', 'change_status', 'ai', 'drive', 'report', 'daily', 'provision')),
  action_config jsonb not null default '{}'::jsonb check (jsonb_typeof(action_config) = 'object'),
  output_type_id uuid references public.task_types(id) on delete restrict,
  output_subtype_id uuid references public.task_types(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rule_id, version),
  unique (rule_id, id),
  constraint automation_rule_trigger_valid check (
    (trigger_kind = 'status_transition' and from_status is not null and to_status is not null and from_status <> to_status)
    or (trigger_kind = 'recurrence_occurrence' and from_status is null and to_status is null)
  ),
  constraint automation_rule_output_valid check (
    (action_kind = 'create_card' and output_type_id is not null)
    or action_kind <> 'create_card'
  )
);

alter table public.automation_rules
  add constraint automation_rules_current_version_fk
  foreign key (id, current_version_id)
  references public.automation_rule_versions(rule_id, id)
  deferrable initially immediate;

create table public.task_automation_bindings (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete restrict,
  rule_version_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (task_id, rule_id),
  foreign key (rule_id, rule_version_id)
    references public.automation_rule_versions(rule_id, id) on delete restrict
);

-- Only configs created by adoption carry this marker. All 13 existing rows
-- remain NULL and are never rewritten when a global rule is published.
alter table public.automation_configs
  add column automation_rule_version_id uuid
  references public.automation_rule_versions(id) on delete restrict;

create index task_automation_bindings_version_idx
  on public.task_automation_bindings (rule_version_id) where active;

create table public.automation_rule_events (
  event_key text primary key check (length(event_key) between 1 and 240),
  rule_version_id uuid not null references public.automation_rule_versions(id) on delete restrict,
  task_id uuid not null references public.tasks(id) on delete cascade,
  occurrence_date date,
  state text not null default 'running' check (state in ('running', 'succeeded', 'failed')),
  output_task_id uuid references public.tasks(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index automation_rule_events_task_idx on public.automation_rule_events (task_id, created_at desc);

create table public.daily_script_versions (
  id uuid primary key default gen_random_uuid(),
  execution_task_id uuid not null references public.tasks(id) on delete cascade,
  version integer not null check (version > 0),
  source_hash text not null check (length(source_hash) = 64),
  source jsonb not null default '{}'::jsonb,
  scripts jsonb not null default '[]'::jsonb,
  status text not null check (status in ('matched', 'needs_clarification')),
  created_at timestamptz not null default now(),
  unique (execution_task_id, version),
  unique (execution_task_id, source_hash)
);

-- Description ownership is checked under the task row lock. A human edit
-- breaks ownership, so a later Docs revision cannot overwrite it.
create function public.apply_daily_script_description(
  p_task_id uuid, p_description text, p_title text,
  p_original_title text, p_version_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_task public.tasks;
  write_description boolean;
  write_title boolean;
begin
  select * into current_task from public.tasks where id = p_task_id for update;
  if current_task.id is null then return pg_catalog.jsonb_build_object('description', false, 'title', false); end if;
  write_description := current_task.description is null
    or current_task.description is not distinct from current_task.payload->>'daily_script_auto_description';
  write_title := current_task.title is not distinct from p_original_title
    or current_task.title is not distinct from current_task.payload->>'daily_script_auto_title';
  update public.tasks set
    description = case when write_description then p_description else description end,
    title = case when write_title then p_title else title end,
    payload = coalesce(payload, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'daily_script_auto_description', case when write_description then p_description else current_task.payload->>'daily_script_auto_description' end,
      'daily_script_auto_title', case when write_title then p_title else current_task.payload->>'daily_script_auto_title' end,
      'daily_script_version_id', p_version_id
    )
  where id = p_task_id;
  return pg_catalog.jsonb_build_object('description', write_description, 'title', write_title);
end;
$$;
revoke all on function public.apply_daily_script_description(uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.apply_daily_script_description(uuid,text,text,text,uuid) to service_role;

create function public.automation_rule_version_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Published automation versions are immutable' using errcode = '23514';
end;
$$;

create trigger automation_rule_version_immutable
  before update or delete on public.automation_rule_versions
  for each row execute function public.automation_rule_version_immutable();

create function public.publish_automation_rule(
  p_rule_id uuid,
  p_name text,
  p_active boolean,
  p_definition jsonb,
  p_created_by uuid
)
returns public.automation_rule_versions
language plpgsql security definer set search_path = '' as $$
declare
  rule_row public.automation_rules;
  version_row public.automation_rule_versions;
  source_type public.task_types;
  source_subtype public.task_types;
  output_type public.task_types;
  output_subtype public.task_types;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Automation name is required' using errcode = '23514';
  end if;
  select * into source_type from public.task_types where id = (p_definition->>'sourceTypeId')::uuid and active;
  if source_type.id is null then raise exception 'Invalid source type' using errcode = '23514'; end if;
  if p_definition->>'sourceSubtypeId' is not null then
    select * into source_subtype from public.task_types where id = (p_definition->>'sourceSubtypeId')::uuid and active;
    if source_subtype.parent_id is distinct from source_type.id then
      raise exception 'Source subtype does not belong to type' using errcode = '23514';
    end if;
  end if;
  if p_definition->>'outputTypeId' is not null then
    select * into output_type from public.task_types where id = (p_definition->>'outputTypeId')::uuid and active;
    if output_type.id is null then raise exception 'Invalid output type' using errcode = '23514'; end if;
  end if;
  if p_definition->>'outputSubtypeId' is not null then
    select * into output_subtype from public.task_types where id = (p_definition->>'outputSubtypeId')::uuid and active;
    if output_subtype.parent_id is distinct from output_type.id then
      raise exception 'Output subtype does not belong to type' using errcode = '23514';
    end if;
  end if;
  if p_definition->>'workflowStepId' is not null and not exists (
    select 1 from public.workflow_version_steps s
    where s.id = (p_definition->>'workflowStepId')::uuid
      and s.workflow_version_id = (p_definition->>'workflowVersionId')::uuid
      and s.task_type_id = source_subtype.id
  ) then raise exception 'Workflow step does not match source subtype and version' using errcode = '23514'; end if;

  if p_rule_id is null then
    insert into public.automation_rules (name, active, created_by)
      values (trim(p_name), p_active, p_created_by) returning * into rule_row;
  else
    select * into rule_row from public.automation_rules where id = p_rule_id for update;
    if rule_row.id is null then raise exception 'Automation rule not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.automation_rule_versions (
    rule_id, version, source_type_id, source_subtype_id, workflow_version_id, workflow_step_id,
    trigger_kind, from_status, to_status, action_kind, action_config,
    output_type_id, output_subtype_id, created_by
  ) values (
    rule_row.id, coalesce((select max(version) + 1 from public.automation_rule_versions where rule_id = rule_row.id), 1),
    source_type.id, source_subtype.id,
    (p_definition->>'workflowVersionId')::uuid, (p_definition->>'workflowStepId')::uuid,
    p_definition->>'triggerKind', p_definition->>'fromStatus', p_definition->>'toStatus',
    p_definition->>'actionKind', coalesce(p_definition->'actionConfig', '{}'::jsonb),
    output_type.id, output_subtype.id, p_created_by
  ) returning * into version_row;
  update public.automation_rules set name = trim(p_name), active = p_active,
    current_version_id = version_row.id, updated_at = now() where id = rule_row.id;
  return version_row;
end;
$$;

revoke all on function public.publish_automation_rule(uuid,text,boolean,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.publish_automation_rule(uuid,text,boolean,jsonb,uuid) to service_role;

alter table public.automation_rules enable row level security;
alter table public.automation_rule_versions enable row level security;
alter table public.task_automation_bindings enable row level security;
alter table public.automation_rule_events enable row level security;
alter table public.daily_script_versions enable row level security;

-- All access goes through admin-authenticated API routes with a service client.
revoke all on public.automation_rules, public.automation_rule_versions,
  public.task_automation_bindings, public.automation_rule_events,
  public.daily_script_versions from anon, authenticated;
grant select, insert, update, delete on public.automation_rules,
  public.automation_rule_versions, public.task_automation_bindings,
  public.automation_rule_events, public.daily_script_versions to service_role;

-- A daily on a non-recurring Plan has one occurrence on its due date.
create or replace function public.materialize_recurring_daily(
  p_config_id uuid, p_date date, p_override jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  config public.automation_configs;
  mold public.tasks;
  execution public.tasks;
  effective jsonb;
  workflow_id uuid;
  piece_workflow_id uuid;
  first_step public.workflow_version_steps;
  capture_step public.workflow_version_steps;
  piece_first_step public.workflow_version_steps;
  piece_capture_step public.workflow_version_steps;
  capture_id uuid;
  script_id uuid;
  delivery_id uuid;
  duplicate_script_id uuid;
  piece jsonb;
  piece_index integer := 0;
  due_day date;
begin
  select * into config from public.automation_configs
  where id = p_config_id and automation_key = 'diaria_recorrente' and active;
  if config.id is null then raise exception 'DiÃ¡ria ativa nÃ£o encontrada' using errcode = '23514'; end if;
  select * into mold from public.tasks where id = config.target_task_id;
  if mold.id is null or mold.kind <> 'plano_acao' then
    raise exception 'Molde precisa ser Plano' using errcode = '23514';
  end if;
  if not exists (select 1 from public.client_drive_links links
                 where links.client_id = mold.client_id
                   and links.raw_folder_id is not null
                   and links.uploads_folder_id is not null) then
    raise exception 'Pastas Raw e EdiÃ§Ã£o do cliente nÃ£o configuradas' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(mold.id::text || ':' || p_date::text, 0));
  select * into execution from public.tasks
    where plan_id = mold.id and payload->>'occurrence_date' = p_date::text
    order by created_at limit 1;
  effective := coalesce(execution.payload->'daily_effective', p_override, config.daily_config);
  if effective is null or jsonb_typeof(effective->'pieces') <> 'array'
     or jsonb_array_length(effective->'pieces') = 0
     or effective->>'clientId' is distinct from mold.client_id::text then
    raise exception 'ConfiguraÃ§Ã£o efetiva invÃ¡lida' using errcode = '23514';
  end if;
  select v.id into workflow_id from public.workflow_versions v
    join public.task_types t on t.id = v.delivery_type_id
    where v.delivery_type_id = (effective->>'deliveryTypeId')::uuid
      and t.key = 'criativo' and v.status = 'published'
    order by v.version desc limit 1;
  select * into first_step from public.workflow_version_steps
    where workflow_version_id = workflow_id order by order_index limit 1;
  select * into capture_step from public.workflow_version_steps
    where workflow_version_id = workflow_id and step_key = 'captacao';
  if first_step.step_key <> 'roteiro' or capture_step.id is null then
    raise exception 'Workflow precisa iniciar em Roteiro e conter CaptaÃ§Ã£o' using errcode = '23514';
  end if;
  if execution.id is null then
    insert into public.tasks (
      id, client_id, task_type_id, title, status, priority, assignee,
      reviewer_id, approver_id, plan_id, requires_review, requires_approval,
      due_date, start_date, description, client_visible, payload, position,
      recurrence_cadence, recurrence_weekdays, recurrence_day_of_month
    ) values (
      public.workflow_task_uuid(mold.id, 'daily:' || p_date::text),
      mold.client_id, mold.task_type_id, mold.title, 'backlog', mold.priority,
      mold.assignee, mold.reviewer_id, mold.approver_id, mold.id,
      mold.requires_review, mold.requires_approval, p_date, p_date,
      mold.description, mold.client_visible,
      (coalesce(mold.payload, '{}'::jsonb) - 'recurrence_group' - 'recurrence_revision') ||
        pg_catalog.jsonb_build_object('recurrence_parent_id', mold.id,
                                      'occurrence_date', p_date, 'daily_effective', effective,
                                      'daily_config_id', config.id),
      mold.position, null, '{}'::smallint[], null
    ) returning * into execution;
  elsif execution.payload->'daily_effective' is null then
    update public.tasks set payload = coalesce(payload, '{}'::jsonb) ||
      pg_catalog.jsonb_build_object('daily_effective', effective, 'daily_config_id', config.id)
      where id = execution.id returning * into execution;
  end if;

  -- JÃ¡ materializado: alteraÃ§Ãµes no molde nÃ£o reescrevem este ciclo.
  if execution.payload ? 'daily_capture_task_id' then return execution.id; end if;
  capture_id := public.workflow_task_uuid(execution.id, 'daily:capture');
  insert into public.tasks (
    id, client_id, task_type_id, title, status, priority, assignee,
    due_date, start_date, client_visible, payload, position,
    recurrence_cadence, recurrence_weekdays, recurrence_day_of_month
  ) values (
    capture_id, mold.client_id, capture_step.task_type_id,
    execution.title || ' â€” CaptaÃ§Ã£o', 'backlog', execution.priority,
    coalesce(capture_step.default_assignee, execution.assignee), p_date, p_date,
    capture_step.client_visible,
    pg_catalog.jsonb_build_object('daily_execution_id', execution.id),
    capture_step.order_index, null, '{}'::smallint[], null
  );
  insert into public.task_links (parent_id, child_id, relation_kind, slot, position)
    values (execution.id, capture_id, 'structural_member', null, 20);

  for piece in select value from pg_catalog.jsonb_array_elements(effective->'pieces') loop
    piece_index := piece_index + 1;
    select v.id into piece_workflow_id from public.workflow_versions v
      join public.task_types t on t.id = v.delivery_type_id
      where v.delivery_type_id = coalesce(nullif(piece->>'deliveryTypeId', '')::uuid,
                                           (effective->>'deliveryTypeId')::uuid)
        and t.behavior = 'entrega' and v.status = 'published'
        and (case when piece ? 'deliveryTypeId' then t.key = case pg_catalog.lower(piece->>'format')
            when 'reels' then 'entrega_reels'
            when 'story' then 'entrega_story'
            when 'carrossel' then 'entrega_carrossel'
            when 'anúncio' then 'entrega_anuncio'
            when 'banner' then 'entrega_banner'
            else '' end
          else t.key = 'criativo' end)
      order by v.version desc limit 1;
    if piece_workflow_id is null then
      raise exception 'Formato da peça sem cascata publicada' using errcode = '23514';
    end if;
    select * into piece_first_step from public.workflow_version_steps
      where workflow_version_id = piece_workflow_id order by order_index limit 1;
    select * into piece_capture_step from public.workflow_version_steps
      where workflow_version_id = piece_workflow_id and step_key = 'captacao';
    if piece_first_step.step_key <> 'roteiro'
       or piece_first_step.task_type_id is distinct from first_step.task_type_id
       or piece_capture_step.task_type_id is distinct from capture_step.task_type_id then
      raise exception 'Cascata do formato incompatível com Roteiro e Captação compartilhados' using errcode = '23514';
    end if;
    due_day := p_date + (piece->>'offsetDays')::integer;
    delivery_id := public.workflow_task_uuid(execution.id, 'daily:piece:' || (piece->>'key'));
    insert into public.tasks (
      id, client_id, task_type_id, workflow_version_id, title, status, priority,
      assignee, reviewer_id, approver_id, requires_review, requires_approval,
      due_date, start_date, client_visible, payload, position,
      recurrence_cadence, recurrence_weekdays, recurrence_day_of_month
    ) values (
      delivery_id, mold.client_id, coalesce(nullif(piece->>'deliveryTypeId', '')::uuid,
        (effective->>'deliveryTypeId')::uuid),
      piece_workflow_id, piece->>'name', 'backlog', mold.priority, mold.assignee,
      mold.reviewer_id, mold.approver_id, mold.requires_review,
      mold.requires_approval, due_day, p_date, mold.client_visible,
      pg_catalog.jsonb_build_object('formato', piece->>'format',
                                    'daily_execution_id', execution.id,
                                    'daily_piece_key', piece->>'key'),
      piece_index, null, '{}'::smallint[], null
    );
    -- O trigger padrÃ£o materializa o primeiro passo. Reusar o primeiro Roteiro
    -- em todas as Entregas mantÃ©m o workflow publicado e um Ãºnico card real.
    select child_id into duplicate_script_id from public.task_links
      where parent_id = delivery_id and workflow_step_id = piece_first_step.id;
    if script_id is null then
      script_id := duplicate_script_id;
      update public.tasks set title = execution.title || ' â€” Roteiro',
        payload = coalesce(payload, '{}'::jsonb) ||
          pg_catalog.jsonb_build_object('daily_execution_id', execution.id)
        where id = script_id;
      insert into public.task_links (parent_id, child_id, relation_kind, slot, position)
        values (execution.id, script_id, 'structural_member', null, 10);
    else
      delete from public.task_links where parent_id = delivery_id and child_id = duplicate_script_id;
      delete from public.tasks where id = duplicate_script_id;
      insert into public.task_links (parent_id, child_id, relation_kind,
                                     workflow_step_id, slot, position)
        values (delivery_id, script_id, 'workflow_step', piece_first_step.id,
                piece_first_step.step_key, piece_first_step.order_index);
    end if;
    -- CaptaÃ§Ã£o fica preparada no Plano. O elo de workflow nasce quando o
    -- Roteiro Ã© concluÃ­do, conforme a regra sequencial jÃ¡ existente.
    insert into public.task_links (parent_id, child_id, relation_kind, slot, position)
      values (execution.id, delivery_id, 'structural_member', null, 20 + piece_index);
  end loop;
  update public.tasks set payload = payload ||
    pg_catalog.jsonb_build_object('daily_script_task_id', script_id,
                                  'daily_capture_task_id', capture_id)
    where id = execution.id;
  return execution.id;
end;
$$;

commit;
