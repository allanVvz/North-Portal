-- Continues the transaction opened by 20260917120000.

-- Production-only reconciliation for the audited report cutover. Every
-- destructive target is an explicit UUID captured by the 2026-09-17 preflight.
create temporary table cutover_configs on commit drop as
select *
from public.automation_configs
where id = any (array[
  'c16a80f4-ec1a-4868-8061-8b87c77abe3d', '833e9f8a-7c19-411d-baf2-4d84e59eec3d',
  'cec45ea7-0de4-4988-b6fc-b72a108c1c6e', '003e0e61-7e3a-45aa-991a-866cfbdcd66e',
  'b333488b-0817-41d1-95fd-4165ee15c687', '35621a65-c946-470e-9390-f61c5ec16af7',
  '523a9a3a-e498-49e3-bd08-7f5652a581a0', 'f3dab254-eac6-44b2-ab5f-363ee8382ead',
  'ec25b616-544a-439b-b0c0-e02e9a9b2e47', 'dce54dcd-8b2d-40ea-8140-447438762b57'
]::uuid[]);

do $$
begin
  if (select count(*) from cutover_configs) <> 10 then
    raise exception 'Report cutover allowlist changed: expected 10 configs';
  end if;
  if (select count(distinct target_task_id) from cutover_configs where automation_key = 'relatorio_trafego_semanal') <> 5 then
    raise exception 'Report cutover allowlist changed: expected five ads molds';
  end if;
  if (select count(*) from public.tasks where id = any (array[
    '4bd7f5a9-7b06-5bb3-a55e-4f1e31032220',
    '60aa099b-4ea5-51a4-ac5b-18370df7aec7',
    '387b0c82-60d0-57f8-b23c-2b6f8f0baa5a',
    '0f27fbb8-cb15-51e8-9b55-3ee9821b834b',
    '88c10e0b-7325-5128-ba19-672b46b339c1',
    '85c91690-20d2-5160-980c-7e2082d1e122'
  ]::uuid[])) <> 6 then
    raise exception 'Report cutover allowlist changed: expected six invalid deliveries';
  end if;
  if (select count(*) from public.tasks where id = '61c24c82-f2a2-5bf9-8459-0e031ebd11f7') <> 1 then
    raise exception 'CRIS future report step is missing or changed';
  end if;
  if (select count(*) from public.documents where task_id = '61c24c82-f2a2-5bf9-8459-0e031ebd11f7') <> 1 then
    raise exception 'CRIS future report document allowlist changed';
  end if;
end;
$$;

create or replace function pg_temp.derived_task_uuid(parent_id uuid, identity text)
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
  raw_hex := substr(encode(extensions.digest(parent_id::text || ':' || identity, 'sha256'), 'hex'), 1, 32);
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

-- The Storage object itself must be removed through the Storage API before
-- this migration (scripts/cleanup-report-cutover-storage.mjs). SQL removes
-- only the allowlisted document row and its future cards.
delete from public.documents
where task_id = '61c24c82-f2a2-5bf9-8459-0e031ebd11f7';

delete from public.tasks
where id = '61c24c82-f2a2-5bf9-8459-0e031ebd11f7';

delete from public.tasks
where id = any (array[
  '4bd7f5a9-7b06-5bb3-a55e-4f1e31032220',
  '60aa099b-4ea5-51a4-ac5b-18370df7aec7',
  '387b0c82-60d0-57f8-b23c-2b6f8f0baa5a',
  '0f27fbb8-cb15-51e8-9b55-3ee9821b834b',
  '88c10e0b-7325-5128-ba19-672b46b339c1',
  '85c91690-20d2-5160-980c-7e2082d1e122'
]::uuid[]);

delete from public.automation_configs
where id in (select id from cutover_configs);

-- The five existing common recurring cards remain the ads schedules. The
-- dependent conversion config gets its own recurring Automation Delivery.
with automation_definition as (
  select
    delivery_type.id as task_type_id,
    version.id as workflow_version_id
  from public.task_types delivery_type
  join public.task_types delivery_root on delivery_root.id = delivery_type.parent_id
  join public.workflow_versions version on version.delivery_type_id = delivery_type.id
  where delivery_root.key = 'entrega'
    and delivery_type.key = 'automacao'
    and version.status = 'published'
), ads_molds as (
  select task.*
  from cutover_configs config
  join public.tasks task on task.id = config.target_task_id
  where config.automation_key = 'relatorio_trafego_semanal'
)
insert into public.tasks (
  id, client_id, title, status, priority, assignee, due_date, description,
  client_visible, payload, position, reviewer_id, kind, subtype, plan_id,
  requires_review, requires_approval, start_date, end_date,
  scheduled_start_at, scheduled_end_at, progress_weight, approver_id,
  recurrence_cadence, recurrence_weekdays, recurrence_day_of_month, created_by,
  task_type_id, workflow_version_id, workflow_activated_at
)
select
  pg_temp.derived_task_uuid(ads.id, 'automation-delivery-mold:v1'),
  ads.client_id,
  'Relatórios · Automação',
  'backlog', ads.priority, 'Northia', date '2026-09-18',
  'Entrega recorrente dos relatórios de anúncios, Feedback e conversão.',
  false,
  jsonb_build_object(
    'recurrence_group', true,
    'recurrence_cycle', 0,
    'recurrence_revision', 0,
    'automation_actor', 'Northia'
  ),
  ads.position, ads.reviewer_id, 'automacao', null, null,
  true, false, date '2026-09-18', date '2026-09-18',
  null, null, 1, ads.approver_id,
  ads.recurrence_cadence, ads.recurrence_weekdays, ads.recurrence_day_of_month,
  ads.created_by, definition.task_type_id, definition.workflow_version_id, null
from ads_molds ads
cross join automation_definition definition;

update public.tasks ads
set due_date = date '2026-09-18',
    start_date = coalesce(ads.start_date, date '2026-09-18'),
    end_date = greatest(coalesce(ads.end_date, date '2026-09-18'), date '2026-09-18')
where ads.id in (
  select target_task_id from cutover_configs where automation_key = 'relatorio_trafego_semanal'
);

-- Restore the five ads configs unchanged except for clearing the obsolete
-- success marker. Recreate conversion configs on their Delivery molds.
insert into public.automation_configs (
  id, automation_key, target_task_id, performance_template_id, active,
  collect_metric_keys, depends_on_config_id, created_by,
  created_at, updated_at
)
select
  id, automation_key, target_task_id, performance_template_id, active,
  collect_metric_keys, null, created_by, created_at, now()
from cutover_configs
where automation_key = 'relatorio_trafego_semanal';

insert into public.automation_configs (
  id, automation_key, target_task_id, performance_template_id, active,
  collect_metric_keys, depends_on_config_id, created_by,
  created_at, updated_at
)
select
  conversion.id,
  conversion.automation_key,
  pg_temp.derived_task_uuid(ads.target_task_id, 'automation-delivery-mold:v1'),
  conversion.performance_template_id,
  conversion.active,
  conversion.collect_metric_keys,
  ads.id,
  conversion.created_by,
  conversion.created_at,
  now()
from cutover_configs conversion
join cutover_configs ads on ads.id = conversion.depends_on_config_id
where conversion.automation_key = 'relatorio_vendas';

-- Materialize the audited 18/09 occurrences. The schema trigger inserts and
-- links each mandatory first step inside the same transaction.
with definition as (
  select version.id as workflow_version_id,
         version.delivery_type_id as delivery_task_type_id
  from public.workflow_versions version
  join public.task_types delivery_type on delivery_type.id = version.delivery_type_id
  join public.task_types delivery_root on delivery_root.id = delivery_type.parent_id
  where delivery_type.key = 'automacao'
    and delivery_root.key = 'entrega'
    and version.status = 'published'
), molds as (
  select task.*
  from public.tasks task
  join public.automation_configs config on config.target_task_id = task.id
  where config.automation_key = 'relatorio_vendas'
)
insert into public.tasks (
  id, client_id, title, status, priority, assignee, due_date, description,
  client_visible, payload, position, reviewer_id, kind, subtype, plan_id,
  requires_review, requires_approval, start_date, end_date, progress_weight,
  approver_id, recurrence_cadence, recurrence_weekdays,
  recurrence_day_of_month, created_by, task_type_id, workflow_version_id,
  workflow_activated_at
)
select
  pg_temp.derived_task_uuid(mold.id, 'cycle:1'), mold.client_id, mold.title,
  'backlog', mold.priority, mold.assignee, date '2026-09-20', mold.description,
  false,
  jsonb_build_object(
    'recurrence_parent_id', mold.id,
    'occurrence_date', '2026-09-18',
    'recurrence_cycle', 1,
    'automation_actor', 'Northia'
  ),
  mold.position, mold.reviewer_id, 'automacao', null, mold.id,
  true, false, date '2026-09-18', date '2026-09-20', 1,
  mold.approver_id, null, '{}'::smallint[], null, mold.created_by,
  definition.delivery_task_type_id, definition.workflow_version_id, null
from molds mold
cross join definition;

do $$
begin
  if exists (select 1 from public.tasks where id = any (array[
    '4bd7f5a9-7b06-5bb3-a55e-4f1e31032220',
    '60aa099b-4ea5-51a4-ac5b-18370df7aec7',
    '387b0c82-60d0-57f8-b23c-2b6f8f0baa5a',
    '0f27fbb8-cb15-51e8-9b55-3ee9821b834b',
    '88c10e0b-7325-5128-ba19-672b46b339c1',
    '85c91690-20d2-5160-980c-7e2082d1e122',
    '61c24c82-f2a2-5bf9-8459-0e031ebd11f7'
  ]::uuid[])) then
    raise exception 'Allowlisted future report data was not fully removed';
  end if;
  if (select count(*) from public.automation_configs where id in (select id from cutover_configs)) <> 10 then
    raise exception 'Expected ten rebuilt report configs';
  end if;
  if (select count(*) from public.tasks where kind = 'automacao' and payload->>'occurrence_date' = '2026-09-18') <> 5 then
    raise exception 'Expected five Automation deliveries for 2026-09-18';
  end if;
  if (select count(*)
      from public.task_links link
      join public.workflow_version_steps step on step.id = link.workflow_step_id
      join public.tasks parent on parent.id = link.parent_id
      where parent.kind = 'automacao'
        and parent.payload->>'occurrence_date' = '2026-09-18'
        and step.step_key = 'relatorio_anuncios') <> 5 then
    raise exception 'Expected five mandatory first report steps for 2026-09-18';
  end if;
end;
$$;

commit;
