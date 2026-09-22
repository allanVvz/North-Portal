-- O agendamento das automações passa a ter UMA fonte da verdade, e a chamada
-- deixa de ser abortada no meio.
--
-- 1. HORÁRIO. Três migrações escreveram o mesmo schedule com valores
--    diferentes: 20260821025707 criou o job às 08:00 UTC, 20260915130000 o moveu
--    para 12:00 UTC ("relatórios às 9h") e 20260917120000 o trouxe de volta para
--    11:00 UTC sem citar a decisão anterior. O canônico é 11:00 UTC = 08:00
--    America/Sao_Paulo, conforme docs/reporting/decisoes.md (17/09); a decisão
--    das 9h fica revogada. Esta migração afirma esse valor em vez de assumir
--    que a ordem de aplicação resolveu.
--
-- 2. TIMEOUT. `net.http_post` tem `timeout_milliseconds` DEFAULT 5000, e nenhuma
--    das migrações anteriores o informou. A rota gera relatório (Meta/Windsor +
--    render de PDF + leitura do comentário) e passa de 5s com folga: o pg_net
--    abortava a requisição, a conexão caía e a execução podia morrer no meio —
--    sem exceção para `markTaskParada` registrar, sem relatório, e com a linha
--    em `automation_runs` presa em `running`. 300000 ms cobre o teto de duração
--    da função na Vercel.
--
-- 3. EXISTÊNCIA. Se o job tiver sido removido, `cron.alter_job` não o recria e a
--    automação segue parada em silêncio. Aqui ele é recriado com o mesmo comando
--    baseado no Vault de 20260901010000.

do $$
declare
  automation_job_id bigint;
  automation_command text := $cmd$
  select net.http_post(
    url := 'https://northportal.vercel.app/api/admin/automations/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'automations_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'automations_cron_secret');
  $cmd$;
begin
  select jobid into automation_job_id from cron.job where jobname = 'automations-run-daily';

  if automation_job_id is null then
    raise notice 'automations-run-daily não existia — recriando.';
    perform cron.schedule('automations-run-daily', '0 11 * * *', automation_command);
    return;
  end if;

  perform cron.alter_job(
    job_id := automation_job_id,
    schedule := '0 11 * * *',
    command := automation_command,
    active := true
  );
end
$$;
