-- A recurrence cycle now produces a real Kanban card.
--
-- Until now nothing connected `recurring_tasks` to `tasks`: "Concluir ciclo"
-- only pushed the date forward, so a routine described work that never entered
-- anyone's board. That is also why a routine's `kind` borrowed the Kanban
-- vocabulary without ever becoming a task.
--
-- The FK is nullable and ON DELETE SET NULL: deleting a routine must never
-- delete delivered work, so the occurrence survives as an ordinary card
-- (payload.recurrence keeps its provenance readable).

alter table public.tasks
  add column if not exists recurring_task_id uuid
    references public.recurring_tasks(id) on delete set null;

create index if not exists tasks_recurring_task_id_idx
  on public.tasks(recurring_task_id)
  where recurring_task_id is not null;

-- Idempotency key: one occurrence per (routine, date). Makes "Gerar tarefa
-- agora" followed by "Concluir ciclo", and any retried request, converge on the
-- same single card instead of piling up duplicates.
create unique index if not exists tasks_recurring_occurrence_unique_idx
  on public.tasks(recurring_task_id, due_date)
  where recurring_task_id is not null and due_date is not null;


-- Deliberately NOT security definer: the insert runs under the caller's RLS, so
-- it is impossible to write a task for a client the caller cannot see.
create or replace function public.materialize_recurring_occurrence(
  target_id uuid,
  occurrence_date date
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  routine public.recurring_tasks;
  occurrence public.tasks;
  next_position integer;
  was_created boolean;
begin
  select * into routine from public.recurring_tasks where id = target_id;
  if not found then
    raise exception 'Tarefa recorrente não encontrada.' using errcode = 'P0002';
  end if;

  select coalesce(max(position), -1) + 1 into next_position
  from public.tasks
  where status = 'backlog' and client_id is not distinct from routine.client_id;

  insert into public.tasks (
    client_id, recurring_task_id, kind, title, status, priority, assignee,
    reviewer_id, approver_id, plan_id, requires_review, requires_approval,
    due_date, description, client_visible, payload, position
  ) values (
    routine.client_id, routine.id, routine.kind, routine.title,
    'backlog', routine.priority, routine.assignee,
    -- A routine carries no reviewer/approver model, so the occurrence starts
    -- with none. false is a subset of whatever the client flow flags would
    -- allow, so this can never contradict the rules in /api/admin/tasks.
    null, null, null, false, false,
    occurrence_date, routine.description, routine.client_visible,
    jsonb_strip_nulls(jsonb_build_object(
      'hora', to_char(routine.time_of_day, 'HH24:MI'),
      'recurrence', jsonb_build_object(
        'recurring_task_id', routine.id,
        'title',             routine.title,
        'cadence',           routine.cadence,
        'cycle',             routine.completed_cycles + 1,
        'occurrence_date',   occurrence_date
      )
    )),
    next_position
  )
  on conflict (recurring_task_id, due_date)
    where recurring_task_id is not null and due_date is not null
  do nothing
  returning * into occurrence;

  was_created := found;

  if not was_created then
    select * into occurrence from public.tasks
    where recurring_task_id = routine.id and due_date = occurrence_date
    limit 1;
  end if;

  return jsonb_build_object('task', to_jsonb(occurrence), 'created', was_created);
end;
$$;


-- Cycle completion v2. Additive on purpose: complete_recurring_task(uuid) stays
-- in place so a rolling deploy (or a rollback) never has old code calling a
-- changed signature and reading a successful completion as a failure.
create or replace function public.complete_recurring_cycle(
  target_id uuid,
  expected_due_date date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  routine public.recurring_tasks;
  occurrence_date date;
  next_date date;
  next_month date;
  materialized jsonb;
begin
  select * into routine from public.recurring_tasks
  where id = target_id
  for update;

  if not found then
    raise exception 'Tarefa recorrente não encontrada.' using errcode = 'P0002';
  end if;
  if not routine.active then
    raise exception 'Não é possível concluir uma recorrência pausada.' using errcode = 'P0001';
  end if;

  occurrence_date := coalesce(routine.next_due_date, (now() at time zone routine.timezone)::date);

  -- Optimistic concurrency: the caller states WHICH cycle it is closing.
  -- The row lock alone is not enough — it only serialises the two requests, and
  -- the loser would then happily close the NEXT cycle (a different due_date, so
  -- the unique index never fires), silently double-counting completed_cycles.
  if expected_due_date is not null and expected_due_date <> occurrence_date then
    raise exception 'Este ciclo já foi concluído.' using errcode = '55000';
  end if;

  materialized := public.materialize_recurring_occurrence(target_id, occurrence_date);

  if routine.cadence = 'mensal' then
    next_month := (date_trunc('month', occurrence_date) + interval '1 month')::date;
    next_date := make_date(
      extract(year from next_month)::integer,
      extract(month from next_month)::integer,
      least(routine.day_of_month, extract(day from (next_month + interval '1 month - 1 day'))::integer)
    );
  elsif routine.cadence = 'quinzenal' then
    next_date := occurrence_date + 14;
  elsif cardinality(routine.weekdays) > 0 then
    select occurrence_date + offset_days into next_date
    from generate_series(1, 7) as offset_days
    where extract(dow from occurrence_date + offset_days)::smallint = any(routine.weekdays)
    order by offset_days
    limit 1;
  else
    next_date := occurrence_date + 7;
  end if;

  update public.recurring_tasks
  set completed_cycles = completed_cycles + 1,
      last_completed_at = now(),
      next_due_date = next_date
  where id = target_id
  returning * into routine;

  return jsonb_build_object(
    'recurring_task', to_jsonb(routine),
    'task',           materialized -> 'task',
    'created',        materialized -> 'created'
  );
end;
$$;

grant execute on function public.materialize_recurring_occurrence(uuid, date) to authenticated, service_role;
grant execute on function public.complete_recurring_cycle(uuid, date) to authenticated, service_role;

comment on function public.complete_recurring_task(uuid) is
  'DEPRECATED — substituída por complete_recurring_cycle(uuid, date). Remover uma release após o deploy.';
