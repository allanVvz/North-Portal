-- Recurrence stops being a card TYPE and becomes an ATTRIBUTE of the date.
--
-- The previous model (a separate `recurring_tasks` table + a dedicated card
-- kind) meant a routine could never be an ordinary Kanban card, never relate to
-- other cards, and never appear anywhere the rest of the work lives. Any task
-- can now carry a recurrence, and a card that carries one behaves like a Plano
-- de Ação: it is a parent, and each execution hangs under it via `plan_id`.
--
-- `recurrence_cadence IS NULL` means "not recurring" — no extra flag to keep in
-- sync. `due_date` on the parent is the next execution; the children are the
-- executions already run.

alter table public.tasks
  add column if not exists recurrence_cadence text
    check (recurrence_cadence is null or recurrence_cadence in ('semanal', 'quinzenal', 'mensal')),
  add column if not exists recurrence_weekdays smallint[] not null default '{}',
  add column if not exists recurrence_day_of_month smallint;

alter table public.tasks
  drop constraint if exists tasks_recurrence_weekdays_valid,
  add constraint tasks_recurrence_weekdays_valid
    check (recurrence_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]);

alter table public.tasks
  drop constraint if exists tasks_recurrence_day_of_month_valid,
  add constraint tasks_recurrence_day_of_month_valid
    check (recurrence_day_of_month is null or recurrence_day_of_month between 1 and 31);

-- Monthly recurrence needs an anchor day; the others must not carry one.
alter table public.tasks
  drop constraint if exists tasks_recurrence_monthly_day,
  add constraint tasks_recurrence_monthly_day
    check (recurrence_cadence is distinct from 'mensal' or recurrence_day_of_month is not null);

create index if not exists tasks_recurrence_due_idx
  on public.tasks(recurrence_cadence, due_date)
  where recurrence_cadence is not null;


-- Carry the existing routines over as real Kanban cards. They land in
-- `backlog` with their next execution as the due date.
insert into public.tasks (
  client_id, kind, title, description, status, priority, assignee,
  requires_review, requires_approval, due_date, client_visible,
  recurrence_cadence, recurrence_weekdays, recurrence_day_of_month, payload, position
)
select
  r.client_id,
  -- The dedicated "publicacao_recorrente" kind no longer means anything now
  -- that recurrence is orthogonal to kind.
  case when r.kind = 'publicacao_recorrente' then 'criativo' else r.kind end,
  r.title, r.description, 'backlog', r.priority, r.assignee,
  false, false, r.next_due_date, r.client_visible,
  r.cadence, r.weekdays, r.day_of_month,
  jsonb_strip_nulls(jsonb_build_object(
    'hora', to_char(r.time_of_day, 'HH24:MI'),
    'migrated_from_recurring_task', r.id::text,
    'completed_cycles', r.completed_cycles
  )),
  r.position
from public.recurring_tasks r
where not exists (
  select 1 from public.tasks t
  where t.client_id = r.client_id and t.title = r.title and t.recurrence_cadence is not null
);
