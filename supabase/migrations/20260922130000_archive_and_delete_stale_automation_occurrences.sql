-- Arquiva e apaga as Entregas "Relatórios · Automação" órfãs que sobraram
-- depois do reset de 20260922120000 (o molde antigo foi apagado ali, mas a
-- ocorrência da semana em andamento não — por escolha explícita do usuário
-- naquela migration). Elas duplicavam a tela de Operação › Entregas junto com
-- as ocorrências novas geradas pelo disparo manual do mesmo dia.
--
-- Pedido explícito do usuário: arquivar como histórico reproduzível de teste,
-- depois apagar o card. Cada linha do arquivo é uma árvore JSON autocontida —
-- a ocorrência, as etapas (com payload/comentários), os relatórios de tráfego
-- e conversão e os metadados dos documentos.
--
-- Só 3 das 5 órfãs puderam ser apagadas: Karpinski, ROSE DIAS e UTZIG GARAGE
-- nunca passaram da 1ª etapa (só o relatório de anúncios). Baita e CRIS CAR
-- CARE tinham as 3 etapas completas — tráfego e feedback aprovados, conversão
-- em revisão — e cada uma tem uma linha em `conversion_report_snapshots`, que
-- é append-only (trigger `reject_conversion_report_snapshot_mutation` recusa
-- até a mutação em CASCATA do Postgres, não só UPDATE/DELETE manual). Apagar
-- a etapa de feedback/conversão delas dispararia essa recusa. Ficam como
-- estão; a decisão de como tratá-las (aprovar manualmente para fechar a
-- Entrega, ou outra coisa) é um follow-up separado, não desta migration.
--
-- Ordem importa: a OCORRÊNCIA (o card Entrega) é apagada primeiro — apagar as
-- etapas antes dispara `delivery_workflow_is_consistent` ("A Delivery cannot
-- exist without its first workflow step"), porque esse é um constraint
-- trigger IMEDIATO, não adiável até o fim da transação. Com a ocorrência já
-- apagada (cascata leva os elos `task_links` junto), as etapas viram tarefas
-- órfãs comuns e saem sem essa checagem.
--
-- Nada de Storage é tocado: os PDFs continuam no bucket; só as linhas de
-- `documents` que os referenciam perdem o vínculo com a tarefa apagada
-- (`documents.task_id on delete set null` — a linha em si sobrevive).

begin;

create table if not exists public.automation_occurrence_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  client_id uuid,
  client_name text,
  occurrence_id uuid not null,
  snapshot jsonb not null
);

do $$
declare
  occ_ids uuid[] := array[
    'b9ce324a-ad29-5103-8570-0e82ac83138d', -- Karpinski
    '3ef6940d-43f6-5fe7-a8a4-1fcf6b7c197d', -- ROSE DIAS
    'b38f6e7f-b5cd-5f2c-91cb-c4546418aa81'  -- UTZIG GARAGE
  ];
  found_count integer;
  archived_count integer;
  step_ids uuid[];
begin
  select count(*) into found_count from public.tasks where id = any(occ_ids);
  if found_count <> 3 then
    raise exception 'Allowlist das ocorrências mudou: esperava 3, achei %', found_count;
  end if;

  select coalesce(array_agg(link.child_id), '{}'::uuid[]) into step_ids
  from public.task_links link
  where link.parent_id = any(occ_ids) and link.relation_kind = 'workflow_step';

  insert into public.automation_occurrence_archive_20260922 (client_id, client_name, occurrence_id, snapshot)
  select
    occ.client_id, c.name, occ.id,
    jsonb_build_object(
      'occurrence', to_jsonb(occ),
      'steps', coalesce((
        select jsonb_agg(jsonb_build_object('link', to_jsonb(link), 'task', to_jsonb(step)) order by link.position)
        from public.task_links link
        join public.tasks step on step.id = link.child_id
        where link.parent_id = occ.id and link.relation_kind = 'workflow_step'
      ), '[]'::jsonb),
      'traffic_reports', coalesce((
        select jsonb_agg(to_jsonb(tr))
        from public.traffic_reports tr
        where tr.occurrence_id = occ.id or tr.task_id = any(step_ids)
      ), '[]'::jsonb),
      'conversion_reports', coalesce((
        select jsonb_agg(to_jsonb(cr))
        from public.conversion_reports cr
        where cr.feedback_task_id = any(step_ids)
      ), '[]'::jsonb),
      -- Nenhuma das 3 chegou à etapa de conversão, então não há
      -- conversion_report_snapshots a capturar aqui (ver nota acima).
      'conversion_report_snapshots', '[]'::jsonb,
      'documents', coalesce((
        select jsonb_agg(to_jsonb(d))
        from public.documents d
        where d.task_id = occ.id or d.task_id = any(step_ids)
      ), '[]'::jsonb)
    )
  from public.tasks occ
  left join public.clients c on c.id = occ.client_id
  where occ.id = any(occ_ids);

  select count(*) into archived_count from public.automation_occurrence_archive_20260922 where occurrence_id = any(occ_ids);
  if archived_count <> 3 then
    raise exception 'Arquivamento incompleto (% de 3) — abortando antes de apagar', archived_count;
  end if;

  -- Ocorrência (o card Entrega) primeiro: cascata leva os elos task_links.
  -- Etapas depois, já órfãs, sem constraint de Delivery sobre elas.
  delete from public.tasks where id = any(occ_ids);
  delete from public.tasks where id = any(step_ids);
end
$$;

-- Confere: nada das 6 tarefas (3 ocorrências + suas etapas) restou.
do $$
declare leftover integer;
begin
  select count(*) into leftover from public.tasks
  where id in (
    'b9ce324a-ad29-5103-8570-0e82ac83138d','3ef6940d-43f6-5fe7-a8a4-1fcf6b7c197d','b38f6e7f-b5cd-5f2c-91cb-c4546418aa81',
    '9d7ea144-6976-531d-85dd-16d8887e8787','2d42ae29-2e88-54b5-9520-ceefd8222e4f','0c2e1722-33fd-5fac-9a49-7aba23d97569'
  );
  if leftover > 0 then
    raise exception 'Sobrou % linha(s) viva(s) que deveriam ter sido apagadas', leftover;
  end if;
end
$$;

commit;
