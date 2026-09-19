-- Cada versão do Relatório 2 guarda a interpretação consolidada que gerou o
-- PDF. O snapshot é append-only e sobrevive inclusive a uma tentativa de PDF
-- que precise ser liberada para retry.
begin;

create table if not exists public.conversion_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  traffic_report_id uuid references public.traffic_reports(id) on delete set null,
  feedback_task_id uuid references public.tasks(id) on delete set null,
  conversion_task_id uuid references public.tasks(id) on delete set null,
  scope_key text not null,
  source_fingerprint text not null,
  interpretation jsonb not null default '{}'::jsonb,
  conversion_metrics jsonb not null default '{}'::jsonb,
  parser text not null default '',
  created_at timestamptz not null default now(),
  unique (scope_key, source_fingerprint)
);

create index if not exists conversion_report_snapshots_feedback_created_idx
  on public.conversion_report_snapshots (feedback_task_id, created_at desc);

alter table public.conversion_report_snapshots enable row level security;
drop policy if exists "conversion report snapshots admin select" on public.conversion_report_snapshots;
drop policy if exists "conversion report snapshots admin insert" on public.conversion_report_snapshots;
create policy "conversion report snapshots admin select" on public.conversion_report_snapshots
  for select to authenticated using (public.is_admin());
create policy "conversion report snapshots admin insert" on public.conversion_report_snapshots
  for insert to authenticated with check (public.is_admin());

create or replace function public.reject_conversion_report_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'conversion_report_snapshots are append-only';
end;
$$;
revoke all on function public.reject_conversion_report_snapshot_mutation() from public;
drop trigger if exists conversion_report_snapshots_immutable on public.conversion_report_snapshots;
create trigger conversion_report_snapshots_immutable
  before update or delete on public.conversion_report_snapshots
  for each row execute function public.reject_conversion_report_snapshot_mutation();

alter table public.conversion_reports
  add column if not exists source_fingerprint text not null default '',
  add column if not exists interpretation jsonb not null default '{}'::jsonb,
  add column if not exists interpretation_snapshot_id uuid
    references public.conversion_report_snapshots(id) on delete set null;

-- Registros legados continuam únicos mesmo sem uma interpretação serializada.
update public.conversion_reports
   set source_fingerprint = coalesce(nullif(source_comment_at, ''), id::text)
 where source_fingerprint = '';

drop index if exists public.conversion_reports_idempotency_idx;
create unique index if not exists conversion_reports_context_idempotency_idx
  on public.conversion_reports (feedback_task_id, traffic_report_id, source_fingerprint);

create index if not exists conversion_reports_feedback_generated_idx
  on public.conversion_reports (feedback_task_id, generated_at desc);
create index if not exists conversion_reports_interpretation_snapshot_idx
  on public.conversion_reports (interpretation_snapshot_id) where interpretation_snapshot_id is not null;

comment on column public.conversion_reports.source_fingerprint is
  'sha-256 do conjunto ordenado de comentários humanos usado para gerar a versão';
comment on column public.conversion_reports.interpretation is
  'interpretação adaptativa auditável: claims, precisão, contexto, decisão e evidências';

commit;
