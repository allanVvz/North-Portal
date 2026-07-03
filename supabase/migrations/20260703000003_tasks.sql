-- Tasks / Kanban backend. Admin manages tasks; a client sees only its own
-- client-visible tasks (reflected in the editorial portal, never the board).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_type') then
    create type public.task_type as enum ('criativo', 'agendamento', 'desempenho');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('backlog', 'em_producao', 'revisao', 'aprovacao', 'concluido');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('baixa', 'media', 'alta');
  end if;
end$$;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  type public.task_type not null default 'criativo',
  title text not null,
  status public.task_status not null default 'backlog',
  priority public.task_priority not null default 'media',
  assignee text,
  due_date date,
  description text,
  client_visible boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_client_id_idx on public.tasks (client_id);
create index if not exists tasks_status_idx on public.tasks (status);

drop trigger if exists set_updated_at on public.tasks;
create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='tasks' loop
    execute format('drop policy if exists %I on public.tasks', r.policyname);
  end loop;
end$$;

-- admin: full access
create policy "tasks admin all" on public.tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- client: read only its own client-visible tasks
create policy "tasks client read visible" on public.tasks
  for select to authenticated
  using (client_visible = true and client_id = public.current_client_id());
