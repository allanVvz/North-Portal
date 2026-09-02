-- Aposenta o molde fixo `relatorio_conversao` (task_type + 2 subtipos, semeado
-- em 20260901000000). O fluxo de feedback/vendas passa a ser DINÂMICO: a
-- automação `relatorio_vendas` promove a ocorrência recorrente a pai de fluxo e
-- cria a etapa de feedback com slot livre, sem depender de um task_type.
--
-- Zero tasks usam `relatorio_conversao` em produção (o modelo antigo roda como
-- `operacional/relatorio_trafego`). `listTaskTypes` filtra `active = true`, então
-- desativar tira o type de todos os lookups em runtime. A linha fica na tabela
-- como histórico.

update public.task_types set active = false
where key = 'relatorio_conversao'
   or parent_id = (select id from public.task_types where key = 'relatorio_conversao' and parent_id is null);

-- A coluna órfã passa a ter dono: além do `coleta_metrica_cliente`, a automação
-- `relatorio_vendas` guarda aqui as métricas (tags) que lê do comentário.
comment on column public.automation_configs.collect_metric_keys is
  'Métricas que a automação pede/lê: chaves de app/admin/metricDefs.ts para coleta_metrica_cliente; tags livres (vendas, agendamentos, seguidores, receita…) para relatorio_vendas.';

-- Subtipos das etapas do fluxo de feedback dinâmico. Existem só para a trava de
-- vocabulário (`tasks_valida_vocabulario`, 20260831120000) aceitar
-- `operacional/trafego` e `operacional/feedback` — `ensureFlowStep` cria as
-- etapas com esse kind. `active/creatable = false`: nunca aparecem em dropdown.
insert into public.task_types
  (parent_id, key, label, order_index, lead_days, progress_weight, default_assignee, client_visible, active, creatable)
values
  ((select id from public.task_types where key = 'operacional' and parent_id is null), 'trafego',  'Relatório de anúncios', 90, 0, 1, 'North ai', false, false, false),
  ((select id from public.task_types where key = 'operacional' and parent_id is null), 'feedback', 'Feedback da semana',    91, 2, 1, null,       true,  false, false)
on conflict do nothing;
