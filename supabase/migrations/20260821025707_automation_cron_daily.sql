-- Cadência agora vem do card escolhido em cada automação registrada (v2), não
-- de um schedule único fixo — o cron precisa checar todo dia quais cards
-- vencem hoje. Substitui o job semanal do v1 por um único job diário. Sem
-- limite conhecido de nº de cron jobs no free tier do Supabase (só
-- recomendação de ≤8 concorrentes, cada um <10min) — 1 job diário e leve
-- fica bem dentro disso, e como bônus mantém o projeto "quente" (evita pausa
-- por inatividade).
select cron.unschedule('automations-run-weekly')
where exists (select 1 from cron.job where jobname = 'automations-run-weekly');

select cron.schedule(
  'automations-run-daily',
  '0 8 * * *', -- todo dia às 08:00 UTC; ajustar ao fuso da agência se necessário
  $$
  select net.http_post(
    url := current_setting('app.automations_endpoint', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  )
  where current_setting('app.automations_endpoint', true) is not null;
  $$
);
