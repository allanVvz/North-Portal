-- Reset das 6 rotinas de automação (relatório de anúncios + Entrega ·
-- Automação) e recadastro com vencimento em hoje (2026-09-22), para o cron das
-- 08:00 BRT de amanhã as pegar sem esperar mais uma semana.
--
-- Por que resetar: os vencimentos dos moldes tinham divergido (a maioria em
-- 28/09, Baita preso em 18/09) e nenhum vencia hoje — o gate de elegibilidade
-- (`run.ts`, `target.due_date !== today`) é igualdade estrita, então nada seria
-- gerado sem essa intervenção.
--
-- O que é apagado: só a ESTEIRA — os dois moldes recorrentes por cliente
-- (`automation_configs` + as tarefas-molde de anúncios e de Entrega ·
-- Automação). `automation_configs.target_task_id` referencia `tasks(id) on
-- delete cascade`, então apagar o molde já apaga sozinho a config e o ledger em
-- `automation_runs` (que também é `on delete cascade` a partir da config).
--
-- O que sobrevive, intacto: as OCORRÊNCIAS já materializadas (cada Entrega da
-- semana e suas etapas), `documents`, `traffic_reports`, `conversion_reports` e
-- `conversion_report_snapshots` — nada disso tem FK para o molde, só para a
-- ocorrência/etapa, que não é tocada aqui. Elas continuam aparecendo em
-- Operação › Entregas como histórico; só perdem o vínculo "Faz parte de" com um
-- molde que não existe mais (`recurrenceParentOf` já tolera parent ausente).
--
-- O recadastro é feito por INSERT direto, não pela RPC
-- `create_automation_config_with_dependency`: ela usa o MESMO
-- `performance_template_id` para o molde de anúncios auto-criado e para a
-- config de conversão, e hoje 3 dos 6 clientes têm templates DIFERENTES entre
-- anúncios e conversão (Baita, CRIS, ROSE) — passar pela RPC perderia essa
-- escolha. Os inserts abaixo espelham exatamente os campos que a RPC grava
-- (mesmo padrão de `kind`/`subtype`/`payload`/`requires_review` etc.), só
-- preservando o `performance_template_id` de cada perna.

begin;

-- Arquivo dos 12 moldes antigos (+ configs) antes de apagar — fonte de
-- rollback/auditoria, nunca lida por código de produção.
create table if not exists public.automation_cleanup_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  task jsonb not null,
  config jsonb not null default '[]'::jsonb
);

do $$
declare
  ids uuid[] := array[
    '10c3d85c-6ed1-4883-94ea-d8d41cddb88a', '15d5096d-fce7-54b2-9960-f302ec0ccd0c', -- Baita: ads, entrega
    'c499448b-bd0a-4bac-b8fc-bfe73339a473', '0e41cb7a-e4a2-5a22-89bd-89ca7e89e807', -- CRIS CAR CARE
    '583dd717-2fd2-4ad6-bd0a-c141ba7c78d8', '281376f8-0fd5-47ab-824e-9ee3e2f8a75f', -- FALKE ESTÉTICA
    'ab69859e-3a80-4bb6-8c68-3b5917effcfe', '57cca525-93a8-5c2f-9ff4-813a72d306f7', -- Karpinski
    '96c6a5ea-af24-49f3-aa10-b6c34f33104c', '36cfd1f1-aa59-5581-9186-bb7460853e7d', -- ROSE DIAS
    'f8362c98-9832-4eeb-a549-bffd7400ad23', '8d91d4c4-3d26-56c9-953e-276e512503ec'  -- UTZIG GARAGE
  ];
  found_count integer;
begin
  select count(*) into found_count from public.tasks where id = any(ids);
  if found_count <> 12 then
    raise exception 'Allowlist dos moldes mudou: esperava 12 tarefas-molde, achei %', found_count;
  end if;

  insert into public.automation_cleanup_archive_20260922(task, config)
  select to_jsonb(t),
    coalesce((select jsonb_agg(to_jsonb(ac)) from public.automation_configs ac where ac.target_task_id = t.id), '[]'::jsonb)
  from public.tasks t
  where t.id = any(ids);

  if (select count(*) from public.automation_cleanup_archive_20260922) < 12 then
    raise exception 'Arquivamento incompleto — abortando antes de apagar';
  end if;

  -- Cascata: automation_configs (target_task_id) e, por ela, automation_runs (config_id).
  delete from public.tasks where id = any(ids);
end
$$;

-- Recadastro: molde de Entrega · Automação + molde de anúncios + as duas
-- automation_configs, por cliente — vencimento hoje.
do $$
declare
  automacao_type_id uuid;
  automacao_version_id uuid;
  ads_type_id uuid;
  today date := current_date; -- roda no mesmo dia do reset (2026-09-22)
  rec record;
  new_entrega_id uuid;
  new_ads_id uuid;
  new_ads_config_id uuid;
begin
  select delivery_type.id, version.id into automacao_type_id, automacao_version_id
  from public.task_types delivery_type
  join public.task_types delivery_root on delivery_root.id = delivery_type.parent_id
  join public.workflow_versions version on version.delivery_type_id = delivery_type.id
  where delivery_root.key = 'entrega' and delivery_type.key = 'automacao' and version.status = 'published';
  if automacao_type_id is null then
    raise exception 'Tipo de Entrega automacao (versão publicada) não encontrado';
  end if;

  select subtype.id into ads_type_id
  from public.task_types subtype
  join public.task_types parent on parent.id = subtype.parent_id
  where parent.key = 'tarefa' and subtype.key = 'relatorio_anuncios';
  if ads_type_id is null then
    raise exception 'Subtipo de Tarefa relatorio_anuncios não encontrado';
  end if;

  -- Um registro por cliente: reviewer, prioridade, posição e os dois templates
  -- (anúncios / conversão) e collect_metric_keys da config antiga, capturados
  -- do banco antes desta migration (ver mensagem do commit para a consulta).
  for rec in
    select * from (values
      ('4f2bfda6-325d-4da3-94ff-c64802e1e2a4'::uuid, 'c87b2f9b-7c23-4539-945a-985ccddfa856'::uuid, -1060, null::text, 'builtin-perfil-negocio-local'::text, array['vendas','agendamentos','seguidores','receita']::text[]),   -- Baita
      ('f1bb7a9f-1d92-4304-b43a-0b0ef6c499be'::uuid, 'c87b2f9b-7c23-4539-945a-985ccddfa856'::uuid, -850,  null::text, 'builtin-estetica-automotiva'::text, array['vendas','agendamentos','seguidores','receita']::text[]),   -- CRIS CAR CARE
      ('0d6167c2-acb5-4d3b-a0e7-a713f0d3d7a2'::uuid, 'c87b2f9b-7c23-4539-945a-985ccddfa856'::uuid, -870,  'builtin-estetica-automotiva'::text, 'builtin-estetica-automotiva'::text, array['vendas','agendamentos','seguidores','receita','verba_disponivel']::text[]), -- FALKE ESTÉTICA
      ('ef3f86b3-03ee-4e9a-96d5-f897bab1aafa'::uuid, 'c87b2f9b-7c23-4539-945a-985ccddfa856'::uuid, -830,  null::text, 'builtin-estetica-automotiva'::text, array['vendas','agendamentos','seguidores','receita','verba_disponivel']::text[]), -- Karpinski
      ('7698938b-f762-4116-8926-b13abf82d809'::uuid, 'c87b2f9b-7c23-4539-945a-985ccddfa856'::uuid, -840,  null::text, 'builtin-perfil-negocio-local'::text, array['vendas','agendamentos','seguidores','receita']::text[]),   -- ROSE DIAS
      ('1b479f4d-f7aa-4ec0-a560-e77df4bb2f7a'::uuid, 'c87b2f9b-7c23-4539-945a-985ccddfa856'::uuid, -870,  null::text, 'builtin-estetica-automotiva'::text, array['vendas','agendamentos','seguidores','receita','verba_disponivel']::text[])  -- UTZIG GARAGE
    ) as t(client_id, reviewer_id, position, conv_template, ads_template, collect_metric_keys)
  loop
    new_entrega_id := gen_random_uuid();
    insert into public.tasks (
      id, client_id, title, status, priority, assignee, due_date,
      client_visible, payload, position, reviewer_id, kind, subtype,
      requires_review, requires_approval, start_date, end_date,
      progress_weight, approver_id, recurrence_cadence,
      recurrence_weekdays, recurrence_day_of_month, created_by,
      task_type_id, workflow_version_id, workflow_activated_at
    ) values (
      new_entrega_id, rec.client_id, 'Relatórios · Automação', 'backlog', 'media', 'North Ai', today,
      false, jsonb_build_object('recurrence_group', true, 'recurrence_cycle', 0, 'recurrence_revision', 0, 'automation_actor', 'North Ai'),
      rec.position, rec.reviewer_id, 'automacao', null,
      true, false, today, today,
      1, null, 'semanal',
      array[1]::smallint[], null, null,
      automacao_type_id, automacao_version_id, null
    );

    new_ads_id := gen_random_uuid();
    insert into public.tasks (
      id, client_id, title, status, priority, assignee, due_date,
      client_visible, payload, position, reviewer_id, kind, subtype,
      requires_review, requires_approval, start_date, end_date,
      progress_weight, approver_id, recurrence_cadence,
      recurrence_weekdays, recurrence_day_of_month, created_by, task_type_id
    ) values (
      new_ads_id, rec.client_id, 'Relatório de anúncios', 'backlog', 'media', 'North Ai', today,
      false, jsonb_build_object('recurrence_group', true, 'recurrence_cycle', 0, 'recurrence_revision', 0),
      rec.position, rec.reviewer_id, 'operacional', 'relatorio_anuncios',
      true, false, today, today,
      1, null, 'semanal',
      array[1]::smallint[], null, null, ads_type_id
    );

    insert into public.automation_configs (automation_key, target_task_id, performance_template_id, active, created_by)
    values ('relatorio_trafego_semanal', new_ads_id, rec.ads_template, true, null)
    returning id into new_ads_config_id;

    insert into public.automation_configs (automation_key, target_task_id, performance_template_id, active, collect_metric_keys, depends_on_config_id, created_by)
    values ('relatorio_conversao', new_entrega_id, rec.conv_template, true, rec.collect_metric_keys, new_ads_config_id, null);
  end loop;
end
$$;

-- Confere: 6 clientes, 2 configs cada, ambas vencendo hoje.
do $$
declare due_today_count integer;
begin
  select count(*) into due_today_count
  from public.automation_configs ac
  join public.tasks t on t.id = ac.target_task_id
  where t.due_date = current_date and ac.active;
  if due_today_count <> 12 then
    raise exception 'Esperava 12 configs ativas vencendo hoje, achei %', due_today_count;
  end if;
end
$$;

commit;
