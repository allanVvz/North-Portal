-- "Publicado" sai do funil, e a RLS quente para de rodar por linha.
--
-- As duas coisas moram na mesma migração de propósito: a lista de status
-- aparece DENTRO das policies de `tasks` e `task_assignees`, então separá-las
-- significaria dropar e recriar a RLS da tabela mais quente duas vezes — duas
-- chances de deixar o app inteiro em 403.
--
-- Pré-requisito: o deploy do código que tira `concluido` de TASK_STATUSES já
-- tem que estar no ar. O código anterior lê `.eq("status","concluido")` no
-- módulo de Performance e renderiza a coluna Publicado; rodar isto antes deixa
-- os dois vazios até o build subir.

-- ---------------------------------------------------------------------------
-- 1. Os 45 cards publicados viram Concluído.
--
-- A data fica marcada no payload. Sem ela um criativo que ESTEVE publicado
-- fica indistinguível de um que só foi concluído, e a informação de "foi ao
-- ar em tal dia" — que hoje só existe implícita no status — some para sempre.
-- ---------------------------------------------------------------------------
update public.tasks
   set status  = 'aprovado',
       payload = payload || jsonb_build_object(
         'publicado_em', to_char(coalesce(completed_at, updated_at), 'YYYY-MM-DD'))
 where status = 'concluido';

create index if not exists tasks_publicado_em_idx
  on public.tasks ((payload->>'publicado_em')) where payload ? 'publicado_em';

-- ---------------------------------------------------------------------------
-- 2. tasks — uma policy por comando, predicados em InitPlan.
--
-- Dois problemas de performance de uma vez, com 276 linhas na tabela e
-- SELECTs de 27 a 61 ms:
--
--   * auth_rls_initplan. `is_admin()` e `current_client_id()` são STABLE
--     SECURITY DEFINER e fazem `select ... from profiles where id = auth.uid()`.
--     Chamadas nuas no `using`, rodam UMA VEZ POR LINHA — 276 leituras de
--     profiles por consulta. Envolvidas em `(select ...)`, o planner as promove
--     a InitPlan: uma vez por consulta.
--
--   * multiple_permissive_policies. "tasks admin all" era FOR ALL, então
--     somava com a policy de cliente em SELECT e em UPDATE, e toda leitura
--     avaliava as duas. Uma por comando, com o OR explícito, avalia uma.
--
-- As expressões abaixo são cópia fiel das que estavam vivas em produção
-- (conferidas em pg_policies antes desta migração, porque o banco já foi
-- remendado por MCP e podia divergir do repositório) — só que envolvidas e
-- fundidas, e sem `concluido` na lista de status.
-- ---------------------------------------------------------------------------
drop policy if exists "tasks admin all"           on public.tasks;
drop policy if exists "tasks client read visible" on public.tasks;
drop policy if exists "tasks client approve own"  on public.tasks;

create policy "tasks select" on public.tasks for select to authenticated
using (
  (select public.is_admin())
  or (
    client_id = (select public.current_client_id())
    and (client_visible = true or status in ('aprovacao', 'aprovado'))
  )
);

create policy "tasks insert" on public.tasks for insert to authenticated
with check ((select public.is_admin()));

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
  or client_id = (select public.current_client_id())
);

create policy "tasks delete" on public.tasks for delete to authenticated
using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. task_assignees — espelha a leitura de tasks, com a mesma lista de status.
-- ---------------------------------------------------------------------------
drop policy if exists "task_assignees client read visible" on public.task_assignees;
create policy "task_assignees client read visible" on public.task_assignees
  for select to authenticated
  using (exists (
    select 1 from public.tasks t
    where t.id = task_assignees.task_id
      and t.client_id = (select public.current_client_id())
      and (t.client_visible = true or t.status in ('aprovacao', 'aprovado'))
  ));

-- ---------------------------------------------------------------------------
-- 4. profiles — "profiles admin write" era FOR ALL e somava com
--    "profiles self read" em toda leitura de perfil, que é o que is_admin()
--    consulta. Era a soma que mais se pagava.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles admin write" on public.profiles;

create policy "profiles select" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles insert" on public.profiles for insert to authenticated
with check ((select public.is_admin()));
create policy "profiles update" on public.profiles for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "profiles delete" on public.profiles for delete to authenticated
using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. notifications — já eram uma por comando; só faltavam os wraps.
-- ---------------------------------------------------------------------------
drop policy if exists "notifications read own or admin"   on public.notifications;
drop policy if exists "notifications update own or admin" on public.notifications;
drop policy if exists "notifications admin insert"        on public.notifications;
drop policy if exists "notifications admin delete"        on public.notifications;

create policy "notifications select" on public.notifications for select to authenticated
using (profile_id = (select auth.uid()) or (select public.is_admin()));
create policy "notifications update" on public.notifications for update to authenticated
using (profile_id = (select auth.uid()) or (select public.is_admin()))
with check (profile_id = (select auth.uid()) or (select public.is_admin()));
create policy "notifications insert" on public.notifications for insert to authenticated
with check ((select public.is_admin()));
create policy "notifications delete" on public.notifications for delete to authenticated
using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 6. Índices de FK que o advisor apontava. Com 276 linhas não são o gargalo —
--    é higiene, e as colunas são majoritariamente nulas, daí os índices
--    parciais. Sem CONCURRENTLY: apply_migration roda em transação.
-- ---------------------------------------------------------------------------
create index if not exists tasks_approver_id_idx
  on public.tasks (approver_id) where approver_id is not null;
create index if not exists tasks_created_by_idx
  on public.tasks (created_by) where created_by is not null;
create index if not exists notifications_task_id_idx
  on public.notifications (task_id) where task_id is not null;
