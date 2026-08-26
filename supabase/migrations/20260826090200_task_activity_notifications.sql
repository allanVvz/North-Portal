-- Notificações de atividade do card: comentário, edição e mudança de status.
--
-- Regra pedida: TODO mundo ligado ao card recebe TUDO — quem criou, quem
-- executa (task_assignees), quem revisa (reviewer_id) e quem aprova
-- (approver_id). Menos o próprio autor da ação: ninguém precisa ser avisado
-- do que acabou de fazer.

-- 1) O índice único (profile_id, task_id, type) existia só para o upsert
--    preguiçoso de task_due_soon. Mantido como estava para esse tipo, ele
--    impediria um segundo comentário no mesmo card de gerar notificação.
--    Vira parcial: só task_due_soon continua colapsando numa linha só.
drop index if exists public.notifications_profile_task_type_idx;
create unique index notifications_due_soon_unique_idx
  on public.notifications (profile_id, task_id, type)
  where type = 'task_due_soon';

-- 2) Fan-out. SECURITY DEFINER porque quem dispara pode ser o cliente
--    comentando no portal, que não tem (e não deve ter) permissão de escrever
--    na caixa de entrada dos outros. A função não aceita destinatário: ela
--    deriva os participantes do próprio card, então não dá para usá-la para
--    mandar notificação a quem não está no card.
create or replace function public.notify_task_participants(
  p_task_id uuid,
  p_type text,
  p_message text,
  p_actor uuid default auth.uid()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if p_task_id is null or p_type is null or p_message is null then
    return 0;
  end if;

  with participants as (
    select t.created_by as profile_id from public.tasks t where t.id = p_task_id
    union
    select t.reviewer_id from public.tasks t where t.id = p_task_id
    union
    select t.approver_id from public.tasks t where t.id = p_task_id
    union
    select ta.profile_id from public.task_assignees ta where ta.task_id = p_task_id
  ),
  recipients as (
    select distinct p.profile_id
      from participants p
      join public.profiles pr on pr.id = p.profile_id
     where p.profile_id is not null
       and (p_actor is null or p.profile_id <> p_actor)
  )
  insert into public.notifications (profile_id, task_id, type, message)
  select r.profile_id, p_task_id, p_type, p_message from recipients r;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_task_participants(uuid, text, text, uuid) from public, anon;
grant execute on function public.notify_task_participants(uuid, text, text, uuid) to authenticated;
