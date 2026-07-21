-- Recurring client routines are independent from action plans and ordinary
-- Kanban task instances. This table stores the durable routine/template; a
-- future materializer can create task occurrences without changing this UI
-- model or overloading tasks.plan_id.

create table if not exists public.recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  description text,
  kind text not null default 'operacional' check (char_length(kind) between 1 and 40 and kind <> 'plano_acao'),
  cadence text not null default 'semanal' check (cadence in ('semanal', 'quinzenal', 'mensal')),
  weekdays smallint[] not null default '{}',
  day_of_month smallint,
  next_due_date date,
  time_of_day time,
  timezone text not null default 'America/Sao_Paulo',
  priority public.task_priority not null default 'media',
  assignee text,
  active boolean not null default true,
  client_visible boolean not null default false,
  completed_cycles integer not null default 0 check (completed_cycles >= 0),
  last_completed_at timestamptz,
  position integer not null default 0,
  template_payload jsonb not null default '{}'::jsonb,
  source text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_tasks_weekdays_valid check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint recurring_tasks_day_of_month_valid check (day_of_month is null or day_of_month between 1 and 31),
  constraint recurring_tasks_monthly_day check (cadence <> 'mensal' or day_of_month is not null)
);

create index if not exists recurring_tasks_client_id_idx
  on public.recurring_tasks(client_id);
create index if not exists recurring_tasks_client_active_position_idx
  on public.recurring_tasks(client_id, active, position);
create index if not exists recurring_tasks_active_due_idx
  on public.recurring_tasks(next_due_date)
  where active = true and next_due_date is not null;
create unique index if not exists recurring_tasks_external_unique_idx
  on public.recurring_tasks(source, external_id)
  where source is not null and external_id is not null;

drop trigger if exists set_updated_at on public.recurring_tasks;
create trigger set_updated_at before update on public.recurring_tasks
  for each row execute function public.set_updated_at();

alter table public.recurring_tasks enable row level security;

create policy "recurring tasks admin all" on public.recurring_tasks
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "recurring tasks client read own" on public.recurring_tasks
  for select to authenticated
  using (client_visible = true and client_id = (select public.current_client_id()));

-- Explicit grants are required by the Data API defaults introduced in 2026.
grant select, insert, update, delete on public.recurring_tasks to authenticated;
grant select, insert, update, delete on public.recurring_tasks to service_role;

-- Completing a cycle updates the durable routine instead of removing it.
-- The row lock prevents two simultaneous completions from losing a cycle.
create or replace function public.complete_recurring_task(target_id uuid)
returns public.recurring_tasks
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_task public.recurring_tasks;
  base_date date;
  next_date date;
  next_month date;
begin
  select * into current_task
  from public.recurring_tasks
  where id = target_id
  for update;

  if not found then
    raise exception 'Tarefa recorrente não encontrada.' using errcode = 'P0002';
  end if;

  if not current_task.active then
    raise exception 'Não é possível concluir uma recorrência pausada.' using errcode = 'P0001';
  end if;

  base_date := coalesce(current_task.next_due_date, (now() at time zone current_task.timezone)::date);

  if current_task.cadence = 'mensal' then
    next_month := (date_trunc('month', base_date) + interval '1 month')::date;
    next_date := make_date(
      extract(year from next_month)::integer,
      extract(month from next_month)::integer,
      least(current_task.day_of_month, extract(day from (next_month + interval '1 month - 1 day'))::integer)
    );
  elsif current_task.cadence = 'quinzenal' then
    next_date := base_date + 14;
  elsif cardinality(current_task.weekdays) > 0 then
    select base_date + offset_days into next_date
    from generate_series(1, 7) as offset_days
    where extract(dow from base_date + offset_days)::smallint = any(current_task.weekdays)
    order by offset_days
    limit 1;
  else
    next_date := base_date + 7;
  end if;

  update public.recurring_tasks
  set completed_cycles = completed_cycles + 1,
      last_completed_at = now(),
      next_due_date = next_date
  where id = target_id
  returning * into current_task;

  return current_task;
end;
$$;

grant execute on function public.complete_recurring_task(uuid) to authenticated;
grant execute on function public.complete_recurring_task(uuid) to service_role;
