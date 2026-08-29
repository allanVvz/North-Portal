-- Conserta um caminho de escrita quebrado em produção desde 2026-08-26.
--
-- `notify_task_reviewer_assigned` (de 20260819000001_notifications.sql) faz
-- `on conflict (profile_id, task_id, type)`. A migração
-- 20260826090200_task_activity_notifications.sql dropou o índice único que
-- servia de árbitro para esse ON CONFLICT e o substituiu por um PARCIAL:
--
--   create unique index notifications_due_soon_unique_idx
--     on public.notifications (profile_id, task_id, type)
--     where type = 'task_due_soon';
--
-- Um índice parcial só pode arbitrar um ON CONFLICT cujo comando tenha o mesmo
-- predicado. Como o trigger insere `type = 'task_review_assigned'`, o Postgres
-- levanta 42P10 — "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" — e a UPDATE inteira falha. Efeito prático: colocar
-- um card em Revisão com revisor atribuído dá erro, e Revisão está ligada para
-- dois clientes hoje.
--
-- Foi encontrado por acaso: o e2e de notificações falhava com exatamente essa
-- mensagem, e a princípio parecia resíduo de teste.
--
-- O conserto segue a INTENÇÃO da migração que quebrou. Ela diz, sobre tornar o
-- índice parcial: "só task_due_soon continua colapsando numa linha só" — ou
-- seja, as demais notificações passaram a ser append. A de revisor só não foi
-- atualizada junto. Vira insert simples: ser feito revisor de novo gera uma
-- notificação nova, não-lida, em vez de reescrever a anterior.

create or replace function public.notify_task_reviewer_assigned()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'revisao' and new.reviewer_id is not null
     and (old.status is distinct from new.status or old.reviewer_id is distinct from new.reviewer_id) then
    insert into public.notifications (profile_id, task_id, type, message)
    values (new.reviewer_id, new.id, 'task_review_assigned', 'Revisão atribuída: "' || new.title || '".');
  end if;
  return new;
end $function$;
