-- O grid de funções deixa de ser decorativo.
--
-- `responsibility_assignments` existe desde 20260827000000 e o próprio código
-- dizia, em dois lugares, "cadastro informativo — não influencia nenhum picker".
-- Era verdade: nada lia a marcação. A partir daqui uma frente decide QUEM é
-- avisado de quê, começando pela única que tem eventos de domínio próprios
-- rodando hoje (os relatórios de tráfego e de vendas das automações).
--
-- Duas partes: renomear a frente, e a função que roteia.

-- ---------------------------------------------------------------------------
-- 1. `metricas` vira `gestor_trafego`
-- ---------------------------------------------------------------------------
-- Por que renomear a KEY e não só o rótulo na tela: a partir da parte 2 a key
-- passa a ser literal dentro de uma função SQL. Deixar `'metricas'` ali
-- significaria que a função que roteia tráfego consulta uma linha chamada
-- "métricas" — um rótulo mentiroso em TSX é cosmético, uma key mentirosa em SQL
-- é dívida que a próxima pessoa gasta meia hora entendendo se é bug.
--
-- A ordem importa: largar o CHECK antes do UPDATE, senão a linha nova viola a
-- constraint velha. A PK é (responsibility, profile_id) e não existe nenhuma
-- linha `gestor_trafego` ainda, então o UPDATE não colide.
alter table public.responsibility_assignments
  drop constraint if exists responsibility_assignments_responsibility_check;

update public.responsibility_assignments
   set responsibility = 'gestor_trafego'
 where responsibility = 'metricas';

alter table public.responsibility_assignments
  add constraint responsibility_assignments_responsibility_check
  check (responsibility in ('edicao', 'captacao', 'roteiro', 'gestor_trafego', 'aprovacao'));

-- Estado pedido: Allan e Luiza são os gestores de tráfego. Casado por
-- `full_name` porque é como o seed original de 20260827000000 já fazia; ambos
-- os comandos são idempotentes.
insert into public.responsibility_assignments (responsibility, profile_id)
select 'gestor_trafego', id from public.profiles
 where role = 'admin' and full_name in ('Allan', 'Luiza')
on conflict do nothing;

delete from public.responsibility_assignments
 where responsibility = 'gestor_trafego'
   and profile_id in (
     select id from public.profiles where role = 'admin' and full_name not in ('Allan', 'Luiza')
   );

-- ---------------------------------------------------------------------------
-- 2. Rotear por frente
-- ---------------------------------------------------------------------------
-- Função separada, e não um parâmetro em `notify_task_participants`, por três
-- razões concretas:
--
--   * Assinatura: acrescentar um argumento àquela função não é `create or
--     replace`, é função nova — as chamadas de 4 argumentos ficariam ambíguas
--     (42725) e seria preciso dropar e refazer os grants no caminho quente que
--     atende TODO produtor de notificação, inclusive o portal do cliente.
--   * Semântica: o leque não aceitar destinatário é garantia dele. Roteamento
--     por responsabilidade é justamente furar isso, e é melhor uma porta
--     explícita do que erodir a garantia da função genérica.
--   * Duplicata: quem é gestor de tráfego E participante do card receberia duas
--     linhas. O `not exists` abaixo resolve contra os mesmos participantes que
--     o leque usa.
--
-- SECURITY DEFINER não é opcional: `responsibility_assignments` tem RLS
-- admin-only, e esta função roda sob service role (automação/cron), sem sessão.
create or replace function public.notify_responsibility_holders(
  p_task_id uuid,
  p_responsibility text,
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
  if p_task_id is null or p_responsibility is null or p_type is null or p_message is null then
    return 0;
  end if;

  if not public.notification_type_allowed(p_type) then
    return 0;
  end if;

  -- Interruptor próprio: se o volume incomodar quem cuida da frente, desligar
  -- o roteamento não pode obrigar a desligar também o aviso para quem trabalha
  -- no card.
  if not public.notification_rule_on('trafficRouting', true) then
    return 0;
  end if;

  insert into public.notifications (profile_id, task_id, type, message)
  select distinct ra.profile_id, p_task_id, p_type, p_message
    from public.responsibility_assignments ra
    join public.profiles pr on pr.id = ra.profile_id
   where ra.responsibility = p_responsibility
     and (p_actor is null or ra.profile_id <> p_actor)
     and (public.notification_rule_on('notifyClients', false) or pr.role <> 'client')
     -- Quem o leque já atendeu neste mesmo evento não recebe segunda linha.
     and not exists (
       select 1 from public.tasks t
        where t.id = p_task_id
          and (t.created_by = ra.profile_id
            or t.reviewer_id = ra.profile_id
            or t.approver_id = ra.profile_id)
     )
     and not exists (
       select 1 from public.task_assignees ta
        where ta.task_id = p_task_id and ta.profile_id = ra.profile_id
     );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_responsibility_holders(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.notify_responsibility_holders(uuid, text, text, text, uuid) to authenticated, service_role;
