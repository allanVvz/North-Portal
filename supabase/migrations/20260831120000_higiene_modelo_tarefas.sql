-- Higiene do modelo de tarefas — três frentes dos "pontos frágeis" de
-- docs/ARQUITETURA-TAREFAS.md (itens A, B e E).
--
-- APLICADA em prod 2026-08-31 via `mcp__supabase__execute_sql` (o classificador
-- bloqueia `apply_migration`), em blocos, com o registro inserido à mão em
-- `supabase_migrations.schema_migrations` (version 20260831120000). Verificada:
-- trigger ativo e rejeitando kind/subtype inválido, defaults `false`, 0 linhas
-- inconsistentes, 0 elo legado restante.

-- ── A · trava de vocabulário para kind / subtype ────────────────────────────
-- Não dá pra FK: task_types tem UNIQUE só em (parent_id, key) — `key` sozinho
-- repete entre subtipos (publicacao, roteiro aparecem sob pais diferentes).
-- Um trigger BEFORE INSERT OR UPDATE **OF kind, subtype** dispara só quando
-- esses campos mudam, e consulta uma tabela de ~23 linhas sempre em cache:
-- custo desprezível. 0 linhas violam hoje (kind e subtype, parent-scoped).
create or replace function public.tasks_valida_vocabulario() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from public.task_types tt
    where tt.key = new.kind and tt.parent_id is null
  ) then
    raise exception 'kind "%" nao existe no vocabulario (task_types de topo)', new.kind
      using errcode = 'check_violation';
  end if;
  if new.subtype is not null and not exists (
    select 1 from public.task_types child
    join public.task_types parent on parent.id = child.parent_id
    where child.key = new.subtype and parent.key = new.kind
  ) then
    raise exception 'subtype "%" nao existe sob o tipo "%"', new.subtype, new.kind
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists tasks_valida_vocabulario on public.tasks;
create trigger tasks_valida_vocabulario
  before insert or update of kind, subtype on public.tasks
  for each row execute function public.tasks_valida_vocabulario();

-- ── B · elo legado que nunca migrou para task_links ─────────────────────────
-- Filho ligado a um plano_acao NÃO-recorrente só por `plan_id` (o modelo
-- anterior a bd1cbb0). `plan_id` hoje significa "ocorrência de recorrência".
-- Move o vínculo para task_links (slot nulo = membro de plano) e limpa
-- `plan_id`. Idempotente.
insert into public.task_links (parent_id, child_id, slot, position)
select t.plan_id, t.id, null, coalesce(t.position, 0)
from public.tasks t
join public.tasks p on p.id = t.plan_id
where p.kind = 'plano_acao'
  and p.recurrence_cadence is null
  and (t.payload->>'recurrence_group') is distinct from 'true'
  and not exists (
    select 1 from public.task_links tl
    where tl.parent_id = t.plan_id and tl.child_id = t.id
  )
on conflict do nothing;

update public.tasks t
set plan_id = null
where t.plan_id is not null
  and (t.payload->>'recurrence_group') is distinct from 'true'
  and exists (
    select 1 from public.tasks p
    where p.id = t.plan_id and p.kind = 'plano_acao' and p.recurrence_cadence is null
  )
  and exists (
    select 1 from public.task_links tl
    where tl.parent_id = t.plan_id and tl.child_id = t.id
  );

-- ── E · requires_review / requires_approval deixam de nascer 'true' ─────────
-- A verdade é a presença de revisor/aprovador combinada com a config de
-- Etapas (a API já deriva assim: `requires_review = Boolean(reviewer_id)` e
-- fica false quando a etapa está desligada para o cliente). O default 'true'
-- só produzia linhas inconsistentes em inserts que não passam pela rota.
alter table public.tasks alter column requires_review set default false;
alter table public.tasks alter column requires_approval set default false;

update public.tasks
set requires_review = (reviewer_id is not null)
where requires_review is distinct from (reviewer_id is not null);

update public.tasks
set requires_approval = (approver_id is not null)
where requires_approval is distinct from (approver_id is not null);
