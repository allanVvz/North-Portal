-- Conserta um segundo caminho de escrita quebrado pela mesma migração que
-- 20260829150000 já consertou uma vez (para o trigger de revisor).
--
-- 20260826090200_task_activity_notifications.sql dropou o índice único geral
-- em (profile_id, task_id, type) e criou um PARCIAL:
--
--   create unique index notifications_due_soon_unique_idx
--     on public.notifications (profile_id, task_id, type)
--     where type = 'task_due_soon';
--
-- `upsertDueSoonNotifications` (lib/notifications.ts) nunca foi atualizada
-- para isso: continua chamando `.upsert(rows, { onConflict:
-- "profile_id,task_id,type" })`, que o PostgREST traduz num
-- `ON CONFLICT (profile_id, task_id, type) DO UPDATE` SEM o predicado
-- parcial — e um índice parcial só arbitra um ON CONFLICT cujo comando tenha
-- o MESMO predicado. Resultado: 42P10 ("there is no unique or exclusion
-- constraint matching the ON CONFLICT specification") toda vez que o usuário
-- logado tem qualquer tarefa com prazo próximo — ou seja, quase sempre.
--
-- GET /api/admin/tasks/notifications chama upsertDueSoonNotifications ANTES
-- de listar — o erro derruba a rota inteira com 503, não só o upsert. Efeito
-- prático: o sino da barra lateral (e a lista "Notificações" da Home, que lê
-- a mesma rota) fica sem atualizar para qualquer usuário com prazo próximo —
-- só "Aguardando sua resposta" continua certo, porque lê os comentários
-- direto, sem passar por `notifications`.
--
-- O conserto, ao contrário do de 20260829150000, não pode virar um insert
-- simples: o comentário original da tabela é explícito — "seu upsert só
-- atualiza `message` no conflito... para marcar como lida continuar valendo
-- mesmo se a mesma tarefa ainda estiver com prazo próximo no próximo poll".
-- Virar insert simples spamaria uma notificação nova a cada carregamento de
-- página. Em vez disso, uma função RPC faz o UPSERT com o predicado certo —
-- SQL cru pode mirar um índice parcial; o helper genérico do PostgREST não.
create or replace function public.upsert_due_soon_notifications(
  p_profile_id uuid,
  p_task_ids uuid[],
  p_messages text[]
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_task_ids is null or array_length(p_task_ids, 1) is null then
    return;
  end if;
  insert into public.notifications (profile_id, task_id, type, message)
  select p_profile_id, t.task_id, 'task_due_soon', t.message
    from unnest(p_task_ids, p_messages) as t(task_id, message)
  on conflict (profile_id, task_id, type) where type = 'task_due_soon'
  do update set message = excluded.message;
end;
$$;

-- security invoker (padrão, sem cláusula): quem chama já passou por
-- requireAdmin() na rota, e a RLS "notifications admin insert" já libera
-- qualquer sessão admin a escrever em qualquer profile_id — mesma base que
-- notify_task_reviewer_assigned (20260829150000) usa hoje.
revoke all on function public.upsert_due_soon_notifications(uuid, uuid[], text[]) from public, anon;
grant execute on function public.upsert_due_soon_notifications(uuid, uuid[], text[]) to authenticated, service_role;
