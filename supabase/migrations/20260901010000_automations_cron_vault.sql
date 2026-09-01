-- A cron de automações lê o x-cron-secret do Vault, não de um GUC.
--
-- 20260821020222_automation_cron.sql pedia ao operador rodar
--   alter database postgres set app.cron_secret = '...'
--   alter database postgres set app.automations_endpoint = '...'
-- mas no Supabase atual o papel `postgres` NÃO tem permissão para
-- ALTER DATABASE / ALTER ROLE SET de parâmetro custom (ERROR 42501). Então o
-- segredo passa a viver no Vault e o job o lê em runtime; a URL do endpoint
-- fica inline no comando do job.
--
-- Operador (uma vez, no SQL Editor do Supabase):
--   select vault.create_secret(
--     '<o MESMO valor de CRON_SECRET configurado na Vercel>',
--     'automations_cron_secret',
--     'x-cron-secret para o job automations-run-daily'
--   );
--
-- Enquanto o segredo não existir no Vault o job é um no-op (o WHERE EXISTS
-- protege) — nada quebra.

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'automations-run-daily'),
  command := $cmd$
  select net.http_post(
    url := 'https://northportal.vercel.app/api/admin/automations/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'automations_cron_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'automations_cron_secret');
  $cmd$
);
