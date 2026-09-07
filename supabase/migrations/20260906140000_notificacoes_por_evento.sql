-- As regras de notificação param de agrupar eventos diferentes, e nasce um
-- caminho para avisar UMA pessoa.
--
-- Contexto: até 2026-09-06 um único interruptor (`updates`) governava três
-- eventos — card criado, card editado e mudança de status. Não havia como calar
-- "foi editado", que é o ruidoso, sem calar junto a mudança de status, que é o
-- sinal que todo mundo quer. Quem se incomodava desligava tudo e passava a não
-- receber nada; quem não desligava recebia tudo. Nenhuma das duas é a
-- configuração que alguém escolheria.
--
-- Três frentes aqui:
--   1. `notification_type_allowed` — o portão de regra vira função própria,
--      porque agora ele tem TRÊS chamadores (o leque, o envio direto abaixo, e
--      o roteamento por responsabilidade da migração seguinte). Duplicar o
--      `case` nos três é exatamente como as regras se separam sem ninguém
--      perceber.
--   2. As chaves novas, e o JSON já gravado reescrito para elas.
--   3. `notify_profiles` — endereçar quem NÃO é participante do card.

-- ---------------------------------------------------------------------------
-- 1. O portão, em um lugar só
-- ---------------------------------------------------------------------------
create or replace function public.notification_type_allowed(p_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'task_commented'       then public.notification_rule_on('comments', true)
    when 'task_created'         then public.notification_rule_on('created', true)
    -- Nasce DESLIGADA: é a queixa que abriu esta frente. Quem quiser o aviso de
    -- edição liga em Configurações › Notificações.
    when 'task_updated'         then public.notification_rule_on('edits', false)
    when 'task_status_changed'  then public.notification_rule_on('statusChanges', true)
    when 'task_due_changed'     then public.notification_rule_on('dueChanged', true)
    when 'task_assigned'        then public.notification_rule_on('assigned', true)
    when 'task_review_assigned' then public.notification_rule_on('reviewAssigned', true)
    when 'task_due_soon'        then public.notification_rule_on('dueSoon', true)
    -- Tipo desconhecido passa: um tipo novo nasce ligado, não silencioso.
    else true
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. O leque passa a usar o portão comum. Nada mais muda nele.
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
  v_notify_clients boolean;
  v_status text;
begin
  if p_task_id is null or p_type is null or p_message is null then
    return 0;
  end if;

  if not public.notification_type_allowed(p_type) then
    return 0;
  end if;

  v_notify_clients := public.notification_rule_on('notifyClients', false);
  select t.status into v_status from public.tasks t where t.id = p_task_id;

  with participants as (
    select t.created_by as profile_id from public.tasks t where t.id = p_task_id
    union
    -- O revisor recebe TUDO como qualquer envolvido, com uma exceção: a entrada
    -- em Revisão. Nessa transição o gatilho dedicado já manda "revisão
    -- atribuída a você", na mesma transação — mandar também o
    -- `task_status_changed` seria a mesma frase duas vezes.
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
       -- p_actor nulo = "o sistema fez isso" (cron, automação). Ninguém é
       -- excluído porque nenhuma pessoa agiu. A CASCATA de fluxo deixou de
       -- passar nulo aqui: ali a ação teve dono, e ele recebia de volta o aviso
       -- do que acabara de fazer.
       and (p_actor is null or p.profile_id <> p_actor)
       and (v_notify_clients or pr.role <> 'client')
  )
  insert into public.notifications (profile_id, task_id, type, message)
  select r.profile_id, p_task_id, p_type, p_message from recipients r;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Envio DIRECIONADO — a quem acabou de entrar no card
-- ---------------------------------------------------------------------------
-- `notify_task_participants` deriva os destinatários do próprio card e não
-- aceita endereçado. Isso é garantia dela, não limitação: é o que impede
-- qualquer chamador de usar o leque para mandar notificação a quem não tem
-- nada com o card. "Você virou responsável" é o caso legítimo oposto — vai
-- para UMA pessoa, e só faz sentido para quem ainda não estava lá.
create or replace function public.notify_profiles(
  p_profile_ids uuid[],
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
  if p_profile_ids is null or array_length(p_profile_ids, 1) is null or p_type is null or p_message is null then
    return 0;
  end if;

  if not public.notification_type_allowed(p_type) then
    return 0;
  end if;

  insert into public.notifications (profile_id, task_id, type, message)
  select distinct pr.id, p_task_id, p_type, p_message
    from public.profiles pr
   where pr.id = any(p_profile_ids)
     -- Quem se atribui não é avisado de que se atribuiu. Mesma regra que o
     -- gatilho do revisor já aplica.
     and (p_actor is null or pr.id <> p_actor)
     and (public.notification_rule_on('notifyClients', false) or pr.role <> 'client');

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. O JSON já gravado
-- ---------------------------------------------------------------------------
-- Reescrever, e não cair num fallback em runtime: `saveNotificationRules` grava
-- o objeto inteiro mesclado, então o primeiro toggle depois do deploy já
-- materializaria as chaves novas e o fallback viveria alguns minutos antes de
-- virar código morto ambíguo.
--
-- `created` e `statusChanges` herdam o valor que `updates` tinha — quem tinha
-- desligado continua desligado. `edits` NÃO herda: quem tinha `updates: true`
-- tinha justamente o ruído, e a decisão desta rodada é que edição nasce
-- silenciosa.
update public.site_settings
   set value = (value - 'updates')
             || jsonb_build_object(
                  'created',       coalesce(value -> 'updates', 'true'::jsonb),
                  'statusChanges', coalesce(value -> 'updates', 'true'::jsonb),
                  'edits',         'false'::jsonb)
 where key = 'notification_rules';

-- ---------------------------------------------------------------------------
-- 5. Permissões
-- ---------------------------------------------------------------------------
-- O `revoke all from public` da migração original mata o grant implícito; sem a
-- linha do service_role as automações e a cascata levam 42501 — e como o
-- chamador engole erro, falhariam EM SILÊNCIO.
revoke all on function public.notification_type_allowed(text) from public, anon;
grant execute on function public.notification_type_allowed(text) to authenticated, service_role;
revoke all on function public.notify_profiles(uuid[], uuid, text, text, uuid) from public, anon;
grant execute on function public.notify_profiles(uuid[], uuid, text, text, uuid) to authenticated, service_role;
