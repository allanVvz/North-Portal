-- Relatórios automáticos toda segunda às 9h (America/Sao_Paulo).
--
-- 1. O job diário passa de 08:00 UTC (05:00 em Brasília) para 12:00 UTC (09:00;
--    o Brasil não tem horário de verão desde 2019). Continua DIÁRIO: a Automação 1
--    só gera no dia em que o molde vence, e a Automação 2 precisa do tique diário
--    para fechar a semana de quem não respondeu ao pedido de feedback.
-- 2. Os moldes com automação de relatório passam a vencer na segunda. Antes,
--    metade tinha recurrence_weekdays [1] e metade [5], todos com due_date numa
--    sexta (18/09). O período reportado é segunda a domingo anteriores
--    (lib/automations/reportData.ts → reportPeriodFor).

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'automations-run-daily'),
  schedule := '0 12 * * *'
);

update public.tasks t
set recurrence_weekdays = array[1],
    due_date = date '2026-09-21',
    end_date = greatest(coalesce(t.end_date, date '2026-09-21'), date '2026-09-21')
where t.recurrence_cadence = 'semanal'
  and t.id in (
    select c.target_task_id
    from public.automation_configs c
    where c.active
      and c.automation_key in ('relatorio_trafego_semanal', 'relatorio_vendas')
  );
