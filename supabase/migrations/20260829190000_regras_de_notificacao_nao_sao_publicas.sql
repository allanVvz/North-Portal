-- Fecha um endpoint público que a migração das regras abriu sem querer.
--
-- Em `20260829170000_regras_de_notificacao.sql` eu revoguei o EXECUTE de
-- PUBLIC/anon em `notify_task_participants` — mas não nas duas funções
-- auxiliares criadas junto. Toda função nasce com EXECUTE para PUBLIC, e o
-- PostgREST expõe o schema `public` inteiro, então
-- `POST /rest/v1/rpc/notification_rules` respondia **sem login nenhum**.
-- Conferido com a chave anon antes deste conserto: devolvia `{}`.
--
-- O vazamento é pequeno — cinco booleanos de configuração da agência, nada de
-- dado de cliente — mas é superfície que ninguém pediu, e o motivo de ela
-- existir foi eu esquecer duas das três funções.
--
-- `authenticated` continua precisando: o gatilho do revisor é SECURITY INVOKER
-- e roda na sessão de quem salva o card, então é ele quem chama
-- `notification_rule_on`. `service_role` idem, para automações e cascata.

revoke all on function public.notification_rules() from public, anon;
revoke all on function public.notification_rule_on(text, boolean) from public, anon;

grant execute on function public.notification_rules() to authenticated, service_role;
grant execute on function public.notification_rule_on(text, boolean) to authenticated, service_role;
