-- Performance results, tied to the specific Kanban card that produced them —
-- once a card is published (status "concluido"), the admin team can register
-- its metrics here (reach, clicks, cost, etc.). `metrics` is a flexible jsonb
-- map (catalog lives in app/admin/metricDefs.ts) so new metric keys can be
-- added later without a migration, and `source` leaves room for a future
-- automated integration (e.g. Meta Ads API) to fill values in directly.
create table if not exists public.task_metrics (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_metrics_client_id_idx on public.task_metrics (client_id);

drop trigger if exists set_updated_at on public.task_metrics;
create trigger set_updated_at before update on public.task_metrics
  for each row execute function public.set_updated_at();

alter table public.task_metrics enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='task_metrics' loop
    execute format('drop policy if exists %I on public.task_metrics', r.policyname);
  end loop;
end$$;

create policy "task_metrics admin all" on public.task_metrics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "task_metrics client read own" on public.task_metrics
  for select to authenticated
  using (client_id = public.current_client_id());
