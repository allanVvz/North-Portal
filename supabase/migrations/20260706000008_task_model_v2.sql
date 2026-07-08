-- Task model v2: Plano de Ação as a real card kind, task→plan membership,
-- workflow-driven progress inputs, and calendar date ranges. The `type` enum
-- (criativo/agendamento/desempenho) becomes a free TEXT `kind` so the kind
-- vocabulary can grow from an in-code catalog (lib/taskCatalog.ts) without
-- further migrations. `desempenho` is dropped as a card type — performance is
-- now an attribute of eligible kinds. Only demo data existed when this ran, so
-- it is a clean destructive change.

-- 1. desempenho demo cards go away entirely.
delete from public.tasks where type = 'desempenho';

-- 2. type (enum) -> kind (text).
alter table public.tasks add column kind text not null default 'criativo';
update public.tasks set kind = type::text;
alter table public.tasks drop column type;
drop type public.task_type;

-- 3. New structured columns. No new tables in this round — plan membership is a
--    self-referencing FK; the general relations graph is a later phase.
alter table public.tasks
  add column subtype             text,
  add column plan_id             uuid references public.tasks(id) on delete set null,
  add column requires_review     boolean not null default true,
  add column requires_approval   boolean not null default true,
  add column start_date          date,
  add column end_date            date,
  add column scheduled_start_at  timestamptz,
  add column scheduled_end_at    timestamptz,
  add column progress_weight     numeric not null default 1;

create index if not exists tasks_plan_id_idx on public.tasks(plan_id);
