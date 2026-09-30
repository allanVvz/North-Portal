begin;

-- Safe only before any rule has been adopted or executed. Once used, publish
-- a corrected version and keep historical bindings and events.
do $$
begin
  if exists (select 1 from public.task_automation_bindings limit 1)
    or exists (select 1 from public.automation_rule_events limit 1)
    or exists (select 1 from public.daily_script_versions limit 1) then
    raise exception 'Automation rules have live bindings or events; use a forward fix';
  end if;
end;
$$;

drop function public.publish_automation_rule(uuid,text,boolean,jsonb,uuid);
drop function public.apply_daily_script_description(uuid,text,text,text,uuid);
drop table public.daily_script_versions;
drop table public.automation_rule_events;
drop table public.task_automation_bindings;
alter table public.automation_configs drop column automation_rule_version_id;
alter table public.automation_rules drop constraint automation_rules_current_version_fk;
drop table public.automation_rule_versions;
drop table public.automation_rules;
drop function public.automation_rule_version_immutable();

-- Restore the original recurring-only daily function before application cutover.
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
  if mold.id is null or mold.kind <> 'plano_acao' or mold.recurrence_cadence is null then
    raise exception 'Molde precisa ser Plano recorrente' using errcode = '23514';
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
