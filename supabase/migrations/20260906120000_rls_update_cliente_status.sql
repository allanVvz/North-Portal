-- R7.2 — o `with check` da RLS de UPDATE em `tasks` passa a olhar o STATUS.
--
-- O portal do cliente oferece exatamente duas ações num card em "aprovacao"
-- (app/api/client/[slug]/tasks/[id]/route.ts): aprovar, que leva o card a
-- "aprovado", ou pedir ajustes, que NÃO move o card e só anexa o comentário.
-- A rota confere isso — mas a rota não é a única porta. O cliente tem um token
-- válido do Supabase e pode falar direto com o PostgREST, e ali quem decide é
-- só a policy.
--
-- E a policy decidia de menos. As duas metades fazem trabalhos diferentes:
--   * `using`      -> QUAIS linhas o cliente alcança (só as em "aprovacao", e
--                     só sendo o aprovador do card ou gerente da conta);
--   * `with check` -> qual ESTADO NOVO é aceito — e este só validava a posse
--                     (`client_id = current_client_id()`), sem olhar status.
-- Resultado: um card em aprovação podia ser empurrado pelo próprio cliente para
-- "backlog", "revisao", "em_producao" ou "parada". Verificado contra produção
-- em 2026-09-06 antes desta migração: o UPDATE passava sem erro nenhum.
--
-- A correção é fechar o `with check` no conjunto que a tela realmente produz:
-- o card ou continua em "aprovacao" (comentou) ou vai para "aprovado"
-- (aprovou). Nada além disso.
--
-- Por que NÃO um trigger validando coluna a coluna (o cliente ainda consegue
-- editar título/datas de um card que está em aprovação — ver R7.6): um trigger
-- que gate por `public.is_admin()` barraria também o service role, que é quem
-- roda as automações e o cron — `is_admin()` lê `profiles` por `auth.uid()`, e
-- o service role não tem `auth.uid()`. Fechar aquela outra fresta exige um
-- critério que distinga "sem sessão" de "sessão de cliente", e isso é uma
-- decisão à parte, não um detalhe desta.

drop policy if exists "tasks update" on public.tasks;

create policy "tasks update" on public.tasks for update to authenticated
using (
  (select public.is_admin())
  or (
    client_id = (select public.current_client_id())
    and status = 'aprovacao'
    and (approver_id = (select auth.uid()) or (select public.is_manager()))
  )
)
with check (
  (select public.is_admin())
  or (
    client_id = (select public.current_client_id())
    -- As duas únicas saídas que o portal oferece. Combinado com o `using`
    -- acima (que só entrega linhas em "aprovacao"), a transição permitida ao
    -- cliente é exatamente: aprovacao -> aprovacao, ou aprovacao -> aprovado.
    and status in ('aprovacao', 'aprovado')
  )
);
