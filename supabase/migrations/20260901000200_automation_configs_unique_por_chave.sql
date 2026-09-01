-- As duas automações do fluxo de conversão (relatorio_trafego_semanal e
-- relatorio_vendas) apontam para o MESMO molde de entrega recorrente. O índice
-- único era por target_task_id só; passa a ser por (target_task_id,
-- automation_key) — uma automação de cada tipo por card.

drop index if exists public.automation_configs_target_task_idx;

create unique index automation_configs_target_task_key_idx
  on public.automation_configs (target_task_id, automation_key);
