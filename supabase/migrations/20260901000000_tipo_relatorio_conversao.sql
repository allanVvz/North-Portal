-- Tipo-entrega `relatorio_conversao` — o fluxo de conversão / vendas.
--
-- Duas etapas: `relatorio_trafego` (a automação relatorio_trafego_semanal
-- preenche e auto-conclui) → `agendamentos` (manual: o responsável lança as
-- conversões num comentário; a automação relatorio_vendas lê com IA, grava em
-- task_metrics e gera o relatório de vendas + regera o de anúncios).
--
-- Passa no trigger tasks_valida_vocabulario (20260831120000): a raiz existe e
-- os subtipos são filhos dela. `relatorio_trafego` já existe como subtipo de
-- `operacional` (inativo) — coexiste, `unique (parent_id, key)` é por par.

do $$
declare t uuid;
begin
  insert into public.task_types (key, label, order_index, behavior, creatable, active)
    values ('relatorio_conversao', 'Relatório de conversão', 35, 'entrega', true, true)
    on conflict do nothing;

  select id into t from public.task_types where key = 'relatorio_conversao' and parent_id is null;

  insert into public.task_types
    (parent_id, key, label, order_index, lead_days, progress_weight, default_assignee, client_visible)
  values
    (t, 'relatorio_trafego', 'Relatório de tráfego', 10, 0, 1, 'North ai', false),
    (t, 'agendamentos',      'Agendamentos',         20, 2, 1, null,       true)
  on conflict do nothing;
end$$;
