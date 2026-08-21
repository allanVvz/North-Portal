-- Scheduling for the automations cron path (see lib/automations/run.ts and
-- app/api/admin/automations/run/route.ts). Runs inside Postgres via pg_cron
-- + pg_net rather than Vercel Cron, so the eventual move to a VPS only
-- requires updating the two GUCs below, not the schedule itself.
--
-- Before this migration is useful in an environment, an admin/operator must
-- set the destination once (via the Supabase SQL editor or a follow-up
-- migration), e.g.:
--   alter database postgres set app.automations_endpoint = 'https://YOUR-DOMAIN/api/admin/automations/run';
--   alter database postgres set app.cron_secret = 'the same value as CRON_SECRET';
-- Until those GUCs are set, net.http_post below simply has nothing to call
-- (current_setting(..., true) returns null and the request no-ops against an
-- empty url) — safe to apply this migration before the GUCs are configured.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'automations-run-weekly',
  '0 8 * * 1', -- segunda-feira 08:00 UTC; ajustar ao fuso da agência se necessário
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
