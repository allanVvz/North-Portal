begin;

alter table public.automation_configs
  add column if not exists daily_config jsonb;

alter table public.automation_configs
  drop constraint if exists automation_configs_automation_key_check;
alter table public.automation_configs
  add constraint automation_configs_automation_key_check
  check (automation_key in (
    'relatorio_trafego_semanal', 'provisionar_card_metricas',
    'coleta_metrica_cliente', 'relatorio_conversao', 'diaria_recorrente'
  ));

alter table public.automation_configs
  add constraint automation_configs_daily_config_check check (
    (automation_key = 'diaria_recorrente' and daily_config is not null
      and jsonb_typeof(daily_config) = 'object'
      and jsonb_typeof(daily_config->'pieces') = 'array'
      and jsonb_array_length(daily_config->'pieces') > 0)
    or (automation_key <> 'diaria_recorrente' and daily_config is null)
  );

create index if not exists automation_configs_daily_target_idx
  on public.automation_configs (target_task_id)
  where automation_key = 'diaria_recorrente' and active;

-- A chamada inteira é uma transação Postgres. Falha em qualquer card ou elo
-- reverte o ciclo, e o lock por (molde, data) impede duplicatas concorrentes.
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
  first_step public.workflow_version_steps;
  capture_step public.workflow_version_steps;
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
  if config.id is null then raise exception 'Diária ativa não encontrada' using errcode = '23514'; end if;
  select * into mold from public.tasks where id = config.target_task_id;
  if mold.id is null or mold.kind <> 'plano_acao' or mold.recurrence_cadence is null then
    raise exception 'Molde precisa ser Plano recorrente' using errcode = '23514';
  end if;
  if not exists (select 1 from public.client_drive_links links
                 where links.client_id = mold.client_id
                   and links.raw_folder_id is not null
                   and links.uploads_folder_id is not null) then
    raise exception 'Pastas Raw e Edição do cliente não configuradas' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(mold.id::text || ':' || p_date::text, 0));
  select * into execution from public.tasks
    where plan_id = mold.id and payload->>'occurrence_date' = p_date::text
    order by created_at limit 1;
  effective := coalesce(execution.payload->'daily_effective', p_override, config.daily_config);
  if effective is null or jsonb_typeof(effective->'pieces') <> 'array'
     or jsonb_array_length(effective->'pieces') = 0
     or effective->>'clientId' is distinct from mold.client_id::text then
    raise exception 'Configuração efetiva inválida' using errcode = '23514';
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
    raise exception 'Workflow precisa iniciar em Roteiro e conter Captação' using errcode = '23514';
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

  -- Já materializado: alterações no molde não reescrevem este ciclo.
  if execution.payload ? 'daily_capture_task_id' then return execution.id; end if;
  capture_id := public.workflow_task_uuid(execution.id, 'daily:capture');
  insert into public.tasks (
    id, client_id, task_type_id, title, status, priority, assignee,
    due_date, start_date, client_visible, payload, position,
    recurrence_cadence, recurrence_weekdays, recurrence_day_of_month
  ) values (
    capture_id, mold.client_id, capture_step.task_type_id,
    execution.title || ' — Captação', 'backlog', execution.priority,
    coalesce(capture_step.default_assignee, execution.assignee), p_date, p_date,
    capture_step.client_visible,
    pg_catalog.jsonb_build_object('daily_execution_id', execution.id),
    capture_step.order_index, null, '{}'::smallint[], null
  );
  insert into public.task_links (parent_id, child_id, relation_kind, slot, position)
    values (execution.id, capture_id, 'structural_member', null, 20);

  for piece in select value from pg_catalog.jsonb_array_elements(effective->'pieces') loop
    piece_index := piece_index + 1;
    due_day := p_date + (piece->>'offsetDays')::integer;
    delivery_id := public.workflow_task_uuid(execution.id, 'daily:piece:' || (piece->>'key'));
    insert into public.tasks (
      id, client_id, task_type_id, workflow_version_id, title, status, priority,
      assignee, reviewer_id, approver_id, requires_review, requires_approval,
      due_date, start_date, client_visible, payload, position,
      recurrence_cadence, recurrence_weekdays, recurrence_day_of_month
    ) values (
      delivery_id, mold.client_id, (effective->>'deliveryTypeId')::uuid,
      workflow_id, piece->>'name', 'backlog', mold.priority, mold.assignee,
      mold.reviewer_id, mold.approver_id, mold.requires_review,
      mold.requires_approval, due_day, p_date, mold.client_visible,
      pg_catalog.jsonb_build_object('formato', piece->>'format',
                                    'daily_execution_id', execution.id,
                                    'daily_piece_key', piece->>'key'),
      piece_index, null, '{}'::smallint[], null
    );
    -- O trigger padrão materializa o primeiro passo. Reusar o primeiro Roteiro
    -- em todas as Entregas mantém o workflow publicado e um único card real.
    select child_id into duplicate_script_id from public.task_links
      where parent_id = delivery_id and workflow_step_id = first_step.id;
    if script_id is null then
      script_id := duplicate_script_id;
      update public.tasks set title = execution.title || ' — Roteiro',
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
        values (delivery_id, script_id, 'workflow_step', first_step.id,
                first_step.step_key, first_step.order_index);
    end if;
    -- Captação fica preparada no Plano. O elo de workflow nasce quando o
    -- Roteiro é concluído, conforme a regra sequencial já existente.
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

revoke all on function public.materialize_recurring_daily(uuid, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_recurring_daily(uuid, date, jsonb)
  to service_role;

-- The application validates workflow, client and folders before activation.
-- Historical BAITA rows and workspaces remain untouched.
commit;
