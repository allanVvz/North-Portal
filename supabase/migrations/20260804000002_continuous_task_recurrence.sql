-- Replace finite explicit-date groups with the continuous recurrence model.
-- Child ids and both recurrence/action-plan relationships are preserved.

create or replace function public.next_task_recurrence_date(
  p_current date,
  p_start date,
  p_cadence text,
  p_weekdays smallint[]
) returns date
language plpgsql
immutable
as $$
declare
  candidate date;
  anchor date;
  chosen date;
  month_offset integer;
begin
  if p_current is null or p_start is null or coalesce(array_length(p_weekdays, 1), 0) = 0 then
    return null;
  end if;
  if p_cadence in ('semanal', 'quinzenal') then
    for candidate in select generate_series(p_current + 1, p_current + 35, interval '1 day')::date loop
      if extract(dow from candidate)::integer = any(p_weekdays)
        and (p_cadence = 'semanal' or mod(((date_trunc('week', candidate)::date - date_trunc('week', p_start)::date) / 7), 2) = 0)
      then return candidate;
      end if;
    end loop;
  else
    for month_offset in 1..240 loop
      anchor := (date_trunc('month', p_start) + (month_offset || ' months')::interval
        + (least(extract(day from p_start)::integer,
          extract(day from (date_trunc('month', p_start) + ((month_offset + 1) || ' months')::interval - interval '1 day'))::integer) - 1) * interval '1 day')::date;
      select day into chosen
      from generate_series(anchor - 7, anchor + 7, interval '1 day') day
      where extract(dow from day)::integer = any(p_weekdays)
      order by abs(day::date - anchor), day desc
      limit 1;
      if chosen > p_current then return chosen; end if;
    end loop;
  end if;
  return null;
end;
$$;

with legacy_parents as (
  select t.id
  from public.tasks t
  where jsonb_typeof(t.payload -> 'explicit_occurrence_dates') = 'array'
), child_order as (
  select c.id, c.plan_id,
    row_number() over (partition by c.plan_id order by c.due_date nulls last, c.created_at, c.id) - 1 as cycle
  from public.tasks c
  join legacy_parents p on p.id = c.plan_id
), update_children as (
  update public.tasks child
  set payload = (coalesce(child.payload, '{}'::jsonb) - 'explicit_date_group_id' - 'explicit_occurrence_dates')
    || jsonb_build_object('recurrence_parent_id', child.plan_id, 'recurrence_cycle', child_order.cycle)
  from child_order
  where child.id = child_order.id
  returning child.id
), bounds as (
  select p.id,
    least(p.start_date, p.due_date, min(c.due_date)) as first_date,
    greatest(p.end_date, p.due_date, max(c.due_date)) as last_date,
    count(c.id)::integer as child_count
  from public.tasks p
  left join public.tasks c on c.plan_id = p.id
  where p.id in (select id from legacy_parents)
  group by p.id, p.start_date, p.end_date, p.due_date
)
update public.tasks parent
set start_date = coalesce(bounds.first_date, parent.start_date, parent.due_date),
    end_date = coalesce(bounds.last_date, bounds.first_date, parent.end_date, parent.due_date),
    due_date = coalesce(parent.due_date, public.next_task_recurrence_date(
      coalesce(bounds.last_date, bounds.first_date),
      coalesce(bounds.first_date, parent.start_date),
      parent.recurrence_cadence,
      parent.recurrence_weekdays
    )),
    payload = (coalesce(parent.payload, '{}'::jsonb) - 'explicit_occurrence_dates' - 'cycle_completed')
      || jsonb_build_object(
        'recurrence_group', true,
        'recurrence_cycle', greatest(coalesce((parent.payload ->> 'completed_cycles')::integer, 0), bounds.child_count - 1, 0),
        'recurrence_revision', 1
      ),
    updated_at = now()
from bounds
where parent.id = bounds.id;

-- Every other pre-existing recurring parent also receives concurrency
-- metadata. Older monthly rows commonly had no weekday because they used a
-- day-of-month field; derive it from the start anchor.
with recurring as (
  select parent.id,
    coalesce(parent.start_date, parent.due_date, min(child.due_date)) as anchor,
    max(child.due_date) as last_child,
    case
      when coalesce(array_length(parent.recurrence_weekdays, 1), 0) = 0
        and coalesce(parent.start_date, parent.due_date, min(child.due_date)) is not null
      then array[extract(dow from coalesce(parent.start_date, parent.due_date, min(child.due_date)))::smallint]::smallint[]
      else parent.recurrence_weekdays
    end as weekdays
  from public.tasks parent
  left join public.tasks child on child.plan_id = parent.id
  where parent.recurrence_cadence is not null
  group by parent.id
)
update public.tasks parent
set start_date = recurring.anchor,
    due_date = coalesce(parent.due_date, public.next_task_recurrence_date(
      coalesce(recurring.last_child, recurring.anchor), recurring.anchor,
      parent.recurrence_cadence, recurring.weekdays
    )),
    end_date = greatest(parent.end_date, parent.due_date, recurring.last_child, recurring.anchor),
    recurrence_weekdays = recurring.weekdays,
    payload = coalesce(parent.payload, '{}'::jsonb)
      || jsonb_build_object(
        'recurrence_group', true,
        'recurrence_cycle', case when jsonb_typeof(parent.payload -> 'recurrence_cycle') = 'number'
          then (parent.payload ->> 'recurrence_cycle')::integer
          else greatest(coalesce((parent.payload ->> 'completed_cycles')::integer, 0), 0) end,
        'recurrence_revision', case when jsonb_typeof(parent.payload -> 'recurrence_revision') = 'number'
          then (parent.payload ->> 'recurrence_revision')::integer else 1 end
      )
from recurring
where parent.id = recurring.id;

drop function public.next_task_recurrence_date(date, date, text, smallint[]);
