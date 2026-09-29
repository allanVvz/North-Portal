begin;

-- A dated meeting can reference many existing cards, including cards owned by
-- other clients. This is contextual: it never participates in task rollups.
create table public.routine_execution_links (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.tasks(id) on delete cascade,
  cycle_id uuid not null references public.tasks(id) on delete cascade,
  occurrence_date date not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint routine_execution_links_distinct check (task_id <> template_id and task_id <> cycle_id),
  constraint routine_execution_links_unique unique (template_id, cycle_id, task_id)
);
create index routine_execution_links_task_idx on public.routine_execution_links(task_id);
create index routine_execution_links_meeting_idx on public.routine_execution_links(template_id, occurrence_date);

create function public.validate_routine_execution_link()
returns trigger language plpgsql set search_path = '' as $$
declare template public.tasks%rowtype; cycle public.tasks%rowtype;
begin
  select * into template from public.tasks where id = new.template_id;
  select * into cycle from public.tasks where id = new.cycle_id;
  if template.id is null or template.recurrence_cadence is null
     or cycle.id is null or cycle.plan_id is distinct from template.id
     or cycle.client_id is distinct from template.client_id
     or cycle.kind is distinct from template.kind
     or cycle.payload->>'recurrence_parent_id' is distinct from template.id::text
     or coalesce(cycle.payload->>'occurrence_date', cycle.due_date::text) is distinct from new.occurrence_date::text then
    raise exception 'Invalid routine meeting or date' using errcode = '23514';
  end if;
  if exists (select 1 from public.tasks t where t.id = new.task_id and t.recurrence_cadence is not null) then
    raise exception 'A recurrence template cannot be a linked execution' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger validate_routine_execution_link before insert or update on public.routine_execution_links
for each row execute function public.validate_routine_execution_link();

alter table public.routine_execution_links enable row level security;
create policy "routine execution admin all" on public.routine_execution_links
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, delete on public.routine_execution_links to authenticated;

-- The structural link was already absent at the 29/09 preflight. Remove it if
-- a concurrent restore recreated it, then add the dated contextual link.
do $$
begin
  if not exists (select 1 from public.tasks where id = '71e87469-990b-416e-9d0e-a6f57e781343'
    and client_id = 'd7cdbac3-775d-457f-b25a-dbf899687853' and recurrence_cadence is not null)
    or not exists (select 1 from public.tasks where id = 'e5f32ccc-154a-4d11-b5dc-1098bec58fcc'
      and plan_id = '71e87469-990b-416e-9d0e-a6f57e781343' and payload->>'occurrence_date' = '2026-09-16')
    or not exists (select 1 from public.tasks where id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd'
      and client_id = '4f2bfda6-325d-4da3-94ff-c64802e1e2a4' and kind = 'plano_acao' and plan_id is null) then
    raise exception 'Routine link preflight changed';
  end if;
end $$;
delete from public.task_links where parent_id = 'e5f32ccc-154a-4d11-b5dc-1098bec58fcc'
  and child_id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and relation_kind = 'structural_member';
insert into public.routine_execution_links(template_id, cycle_id, occurrence_date, task_id)
values ('71e87469-990b-416e-9d0e-a6f57e781343', 'e5f32ccc-154a-4d11-b5dc-1098bec58fcc',
        date '2026-09-16', '7e1a162d-ff0f-414e-ad50-bea8b472fbcd');

commit;
