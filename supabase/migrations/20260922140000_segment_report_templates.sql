-- Segment report templates are active operational configuration.  This change
-- deliberately does not touch report occurrences, reports, documents or their
-- append-only snapshots: those remain the historical record of what was sent.
--
-- Rollback: restore `performance_template_id` from
-- `automation_config_template_archive_20260922` for this migration key.

begin;

create table if not exists public.automation_config_template_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null,
  archived_at timestamptz not null default now(),
  config_id uuid not null references public.automation_configs(id) on delete restrict,
  previous_template_id text,
  next_template_id text not null,
  unique (migration_key, config_id)
);

do $$
declare
  expected_configs integer;
  archived_configs integer;
  updated_configs integer;
begin
  -- Both active legs (traffic + conversion) use the same segment policy.  The
  -- explicit allowlist prevents a stray/inactive config from being rewritten.
  select count(*) into expected_configs
  from public.automation_configs ac
  join public.tasks t on t.id = ac.target_task_id
  where ac.active
    and ac.automation_key in ('relatorio_trafego_semanal', 'relatorio_conversao')
    and t.client_id in (
      '4f2bfda6-325d-4da3-94ff-c64802e1e2a4'::uuid, -- Baita
      'f1bb7a9f-1d92-4304-b43a-0b0ef6c499be'::uuid, -- CRIS CAR CARE
      '0d6167c2-acb5-4d3b-a0e7-a713f0d3d7a2'::uuid, -- FALKE
      'ef3f86b3-03ee-4e9a-96d5-f897bab1aafa'::uuid, -- Karpinski
      '7698938b-f762-4116-8926-b13abf82d809'::uuid, -- ROSE DIAS
      '1b479f4d-f7aa-4ec0-a560-e77df4bb2f7a'::uuid  -- UTZIG
    );
  if expected_configs <> 12 then
    raise exception 'Esperava 12 configurações ativas de relatório, encontrei %', expected_configs;
  end if;

  insert into public.automation_config_template_archive_20260922
    (migration_key, config_id, previous_template_id, next_template_id)
  select
    '20260922140000_segment_report_templates', ac.id, ac.performance_template_id,
    case
      when t.client_id = 'f1bb7a9f-1d92-4304-b43a-0b0ef6c499be'::uuid then 'builtin-ecommerce'
      when t.client_id in (
        '4f2bfda6-325d-4da3-94ff-c64802e1e2a4'::uuid,
        '7698938b-f762-4116-8926-b13abf82d809'::uuid
      ) then 'builtin-perfil-negocio-local'
      else 'builtin-estetica-automotiva'
    end
  from public.automation_configs ac
  join public.tasks t on t.id = ac.target_task_id
  where ac.active
    and ac.automation_key in ('relatorio_trafego_semanal', 'relatorio_conversao')
    and t.client_id in (
      '4f2bfda6-325d-4da3-94ff-c64802e1e2a4'::uuid,
      'f1bb7a9f-1d92-4304-b43a-0b0ef6c499be'::uuid,
      '0d6167c2-acb5-4d3b-a0e7-a713f0d3d7a2'::uuid,
      'ef3f86b3-03ee-4e9a-96d5-f897bab1aafa'::uuid,
      '7698938b-f762-4116-8926-b13abf82d809'::uuid,
      '1b479f4d-f7aa-4ec0-a560-e77df4bb2f7a'::uuid
    )
  on conflict (migration_key, config_id) do nothing;

  select count(*) into archived_configs
  from public.automation_config_template_archive_20260922
  where migration_key = '20260922140000_segment_report_templates';
  if archived_configs <> 12 then
    raise exception 'Arquivamento incompleto das configurações: esperava 12, encontrei %', archived_configs;
  end if;

  update public.automation_configs ac
  set performance_template_id = archive.next_template_id
  from public.automation_config_template_archive_20260922 archive
  where archive.migration_key = '20260922140000_segment_report_templates'
    and archive.config_id = ac.id
    and ac.performance_template_id is distinct from archive.next_template_id;
  get diagnostics updated_configs = row_count;

  -- A rerun after a transaction retry is a valid no-op; otherwise every active
  -- config should have moved exactly once.
  if updated_configs not in (0, 12) then
    raise exception 'Atualização parcial das configurações: % de 12', updated_configs;
  end if;
end
$$;

commit;
