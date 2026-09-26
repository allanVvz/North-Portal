-- Each daily piece uses its own published delivery workflow. Existing cycles keep their recorded version. — rollback: restore the function from 20260925220658_recurring_daily_materials.sql.
BEGIN;
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

revoke all on function public.materialize_recurring_daily(uuid, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_recurring_daily(uuid, date, jsonb)
  to service_role;

-- Publish a new cascade version while preserving existing cards on their old version.
create or replace function public.publish_delivery_workflow(
  p_delivery_type_id uuid, p_steps jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  delivery public.task_types;
  previous_version public.workflow_versions;
  new_version_id uuid;
  next_version integer;
  item jsonb;
  item_index integer := 0;
  subtype_id uuid;
  item_key text;
begin
  select * into delivery from public.task_types where id = p_delivery_type_id for update;
  if delivery.id is null or delivery.behavior <> 'entrega' then
    raise exception 'Tipo de Entrega não encontrado' using errcode = '23514';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' or
     jsonb_array_length(p_steps) < 1 or jsonb_array_length(p_steps) > 30 then
    raise exception 'A cascata precisa ter de 1 a 30 etapas' using errcode = '23514';
  end if;
  select * into previous_version from public.workflow_versions
    where delivery_type_id = p_delivery_type_id and status = 'published';
  select coalesce(max(version), 0) + 1 into next_version from public.workflow_versions
    where delivery_type_id = p_delivery_type_id;
  insert into public.workflow_versions (delivery_type_id, version, status, label)
    values (p_delivery_type_id, next_version, 'draft', delivery.label || ' v' || next_version)
    returning id into new_version_id;
  for item in select value from pg_catalog.jsonb_array_elements(p_steps) loop
    item_index := item_index + 1;
    item_key := item->>'key';
    select step.id into subtype_id from public.task_types step
      join public.task_types parent on parent.id = step.parent_id
      where parent.key = 'tarefa' and step.key = item_key and step.active;
    if subtype_id is null then
      raise exception 'Etapa % precisa existir em Tarefa', item_key using errcode = '23514';
    end if;
    insert into public.workflow_version_steps (
      workflow_version_id, task_type_id, step_key, label, order_index,
      progress_weight, lead_days, creation_trigger, default_assignee, client_visible
    ) values (
      new_version_id, subtype_id, item_key, item->>'label', item_index * 10,
      (item->>'progress_weight')::numeric, (item->>'lead_days')::integer,
      case when item_index = 1 then 'delivery_created' else 'previous_step_approved' end,
      nullif(item->>'default_assignee', ''), (item->>'client_visible')::boolean
    );
  end loop;
  if previous_version.id is not null then
    update public.workflow_versions set status = 'retired' where id = previous_version.id;
  end if;
  update public.workflow_versions set status = 'published', published_at = now()
    where id = new_version_id;
  return new_version_id;
end;
$$;

revoke all on function public.publish_delivery_workflow(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.publish_delivery_workflow(uuid, jsonb) to service_role;

-- Five independent Delivery types, each starting with a copy of Criativo's
-- published steps. Future edits publish a new version of only that format.
do $$
declare
  delivery_root_id uuid;
  creative_type_id uuid;
  source_version_id uuid;
  format_record record;
  format_type_id uuid;
  format_version_id uuid;
  next_version integer;
begin
  select id into delivery_root_id from public.task_types where key = 'entrega' and parent_id is null;
  select id into creative_type_id from public.task_types where key = 'criativo' and parent_id = delivery_root_id;
  select id into source_version_id from public.workflow_versions
    where delivery_type_id = creative_type_id and status = 'published';
  if source_version_id is null then
    raise exception 'Publique Criativo antes de criar formatos canônicos';
  end if;
  if (select step_key from public.workflow_version_steps
      where workflow_version_id = source_version_id order by order_index limit 1) <> 'roteiro'
     or not exists (select 1 from public.workflow_version_steps
                    where workflow_version_id = source_version_id and step_key = 'captacao') then
    raise exception 'Criativo precisa iniciar em Roteiro e conter Captação';
  end if;
  for format_record in select * from (values
    ('entrega_reels', 'Reels', '▶'),
    ('entrega_story', 'Story', '◔'),
    ('entrega_carrossel', 'Carrossel', '▦'),
    ('entrega_anuncio', 'Anúncio', '◎'),
    ('entrega_banner', 'Banner', '▬')
  ) as formats(key, label, icon) loop
    select id into format_type_id from public.task_types
      where key = format_record.key and parent_id = delivery_root_id;
    if format_type_id is null then
      insert into public.task_types (
        parent_id, key, label, order_index, behavior, creatable, active,
        icon, tone, show_in_performance
      ) values (
        delivery_root_id, format_record.key, format_record.label,
        (select coalesce(max(order_index), 0) + 10 from public.task_types where parent_id = delivery_root_id),
        'entrega', true, true, format_record.icon, 'purple', true
      ) returning id into format_type_id;
    end if;
    if not exists (select 1 from public.workflow_versions
                   where delivery_type_id = format_type_id and status = 'published') then
      select coalesce(max(version), 0) + 1 into next_version from public.workflow_versions
        where delivery_type_id = format_type_id;
      insert into public.workflow_versions (delivery_type_id, version, status, label)
        values (format_type_id, next_version, 'draft', format_record.label || ' v' || next_version)
        returning id into format_version_id;
      insert into public.workflow_version_steps (
        workflow_version_id, task_type_id, step_key, label, order_index,
        progress_weight, lead_days, creation_trigger, default_assignee, client_visible
      ) select format_version_id, task_type_id, step_key, label, order_index,
          progress_weight, lead_days, creation_trigger, default_assignee, client_visible
        from public.workflow_version_steps where workflow_version_id = source_version_id;
      update public.workflow_versions set status = 'published', published_at = now()
        where id = format_version_id;
    end if;
  end loop;
end;
$$;

-- The application validates workflow, client and folders before activation.
-- Historical BAITA rows and workspaces remain untouched.
COMMIT;
