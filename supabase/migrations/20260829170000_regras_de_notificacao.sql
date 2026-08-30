-- As regras de notificação passam a existir de verdade, e no lugar certo.
--
-- Antes disto a tela Configurações › Notificações gravava em `localStorage` e
-- filtrava na renderização: a linha continuava sendo escrita, o sino continuava
-- CONTANDO o que a lista não mostrava, e a escolha valia só naquele navegador.
--
-- A regra é lida AQUI, dentro do banco, e não no TypeScript. Não é preferência
-- de arquitetura, é a única posição possível — três dos quatro produtores de
-- notificação nunca passam por uma rota Next.js (o gatilho do revisor, as
-- automações sob service role, a cascata de fluxo) e, decisivo, `site_settings`
-- tem RLS admin-only: o portal do cliente, justamente quem o leque
-- SECURITY DEFINER existe para atender, não consegue ler a configuração. Um
-- portão em TypeScript ali avaliaria "tudo desligado" para toda ação de cliente.

create or replace function public.notification_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.site_settings where key = 'notification_rules'),
    '{}'::jsonb
  );
$$;

-- O default vem de quem pergunta, não do banco: chave ausente no JSON é o
-- estado normal (ninguém mexeu ainda), e cada regra sabe o próprio padrão.
create or replace function public.notification_rule_on(p_rule text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((public.notification_rules() ->> p_rule)::boolean, p_default);
$$;

-- ---------------------------------------------------------------------------
-- O leque, agora com regra e sem duplicata.
-- ---------------------------------------------------------------------------
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
  v_allowed boolean;
  v_notify_clients boolean;
  v_status text;
begin
  if p_task_id is null or p_type is null or p_message is null then
    return 0;
  end if;

  -- Uma regra por EVENTO, não por tipo: `task_updated`, `task_status_changed` e
  -- `task_created` são a mesma coisa para quem acompanha o card. Tipo
  -- desconhecido passa (default true) — tipo novo nasce ligado, não silencioso.
  v_allowed := case p_type
    when 'task_commented'       then public.notification_rule_on('comments', true)
    when 'task_created'         then public.notification_rule_on('updates', true)
    when 'task_updated'         then public.notification_rule_on('updates', true)
    when 'task_status_changed'  then public.notification_rule_on('updates', true)
    when 'task_review_assigned' then public.notification_rule_on('reviewAssigned', true)
    when 'task_due_soon'        then public.notification_rule_on('dueSoon', true)
    else true
  end;
  if not v_allowed then
    return 0;
  end if;

  v_notify_clients := public.notification_rule_on('notifyClients', false);
  select t.status into v_status from public.tasks t where t.id = p_task_id;

  with participants as (
    select t.created_by as profile_id from public.tasks t where t.id = p_task_id
    union
    -- O revisor recebe TUDO como qualquer envolvido, com uma exceção: a entrada
    -- em Revisão. Nessa transição o gatilho abaixo já manda o aviso dedicado
    -- "revisão atribuída a você", na mesma transação — mandar também o
    -- `task_status_changed` seria a mesma frase duas vezes. Todo o resto
    -- (comentários, edições, outros status) continua chegando.
    select t.reviewer_id from public.tasks t
     where t.id = p_task_id
       and not (p_type = 'task_status_changed' and v_status = 'revisao')
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
       -- p_actor nulo = "o sistema fez isso" (automação, cascata, cron).
       -- Ninguém é excluído, porque nenhuma pessoa agiu.
       and (p_actor is null or p.profile_id <> p_actor)
       -- Não existe sino no portal do cliente — conferido, não há rota nem
       -- componente. Sem esta regra as contas de cliente acumulam linhas que
       -- ninguém nunca vê nem marca como lida.
       and (v_notify_clients or pr.role <> 'client')
  )
  insert into public.notifications (profile_id, task_id, type, message)
  select r.profile_id, p_task_id, p_type, p_message from recipients r;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- O gatilho do revisor honra a mesma regra, e para de avisar quem se atribuiu.
-- ---------------------------------------------------------------------------
create or replace function public.notify_task_reviewer_assigned()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'revisao' and new.reviewer_id is not null
     and (old.status is distinct from new.status or old.reviewer_id is distinct from new.reviewer_id)
     -- Quem se põe como revisor não precisa ser avisado de que se pôs.
     -- auth.uid() é nulo sob service role: aí a atribuição veio do sistema e o
     -- aviso vale.
     and (auth.uid() is null or new.reviewer_id <> auth.uid())
     and public.notification_rule_on('reviewAssigned', true)
     and (public.notification_rule_on('notifyClients', false)
          or (select role from public.profiles where id = new.reviewer_id) <> 'client')
  then
    insert into public.notifications (profile_id, task_id, type, message)
    values (new.reviewer_id, new.id, 'task_review_assigned', 'Revisão atribuída: "' || new.title || '".');
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- Permissões. O `revoke all from public` da migração original matou o grant
-- implícito; sem a linha do service_role as automações e a cascata levam 42501
-- — e como `notifyTaskParticipants` engole erro, elas falhariam EM SILÊNCIO.
-- ---------------------------------------------------------------------------
revoke all on function public.notify_task_participants(uuid, text, text, uuid) from public, anon;
grant execute on function public.notify_task_participants(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.notification_rules() to authenticated, service_role;
grant execute on function public.notification_rule_on(text, boolean) to authenticated, service_role;
