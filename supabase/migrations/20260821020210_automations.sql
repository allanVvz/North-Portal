-- Automações: relatório de anúncios semanal + provisionamento genérico por
-- cliente. See plan/AUTOMACOES-RELATORIO-TRAFEGO.md for the full design.

-- a) documents.task_id — lets a generated report (or any future upload) be
-- linked to the Kanban card that produced it, without a new attachment
-- system. Reuses the existing documents table/bucket/RLS (client already
-- sees it via owns_client()).
alter table public.documents
  add column if not exists task_id uuid references public.tasks(id) on delete set null;
create index if not exists documents_task_idx on public.documents (task_id);

-- b) automation_configs — the per-client (or agency-default) instance of an
-- automation registered from a template card. Vocabulary (label,
-- eligibility) lives in code (lib/automationCatalog.ts); this table only
-- holds the instance, same pattern as integration_credentials.
create table public.automation_configs (
  id uuid primary key default gen_random_uuid(),
  automation_key text not null
    check (automation_key in ('relatorio_trafego_semanal', 'provisionar_card_metricas')),
  scope text not null default 'agency' check (scope in ('agency', 'client')),
  client_id uuid references public.clients(id) on delete cascade,
  -- Automação 1 (relatorio_trafego_semanal): kind/subtype are synthesized in
  -- code (operacional/relatorio_trafego) — kept here only for symmetry/audit.
  target_kind text not null default 'operacional',
  target_subtype text not null default 'relatorio_trafego',
  -- text, not `uuid references performance_templates(id)`: the 3 builtin
  -- templates (lib/performanceTemplates.ts BUILTIN_PERFORMANCE_TEMPLATES,
  -- e.g. 'builtin-full-funnel') are in-code only, never rows in that table —
  -- this column stores either a real template uuid or a builtin's string id.
  performance_template_id text,
  recurrence_cadence text not null default 'semanal'
    check (recurrence_cadence in ('semanal', 'quinzenal', 'mensal')),
  recurrence_weekdays smallint[] not null default '{1}',
  recurrence_day_of_month smallint,
  -- Automação 2 (provisionar_card_metricas): points at the real template
  -- card (task, rotina or plano de ação) chosen/created on the screen.
  template_task_id uuid references public.tasks(id) on delete set null,
  active boolean not null default true,
  parent_task_id uuid references public.tasks(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope = 'agency' or client_id is not null)
);
create unique index automation_configs_agency_key_idx
  on public.automation_configs (automation_key) where scope = 'agency';
create unique index automation_configs_client_key_idx
  on public.automation_configs (automation_key, client_id) where scope = 'client';

drop trigger if exists set_updated_at on public.automation_configs;
create trigger set_updated_at before update on public.automation_configs
  for each row execute function public.set_updated_at();

alter table public.automation_configs enable row level security;
create policy "automation configs admin all" on public.automation_configs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- c) vault_authorized(): add a service-role clause so a pg_cron/pg_net job
-- (no auth.uid() session) can read the Windsor/Meta API key an admin already
-- saved through the UI. vault_set_secret is untouched — the cron path never
-- creates a new secret, only reads existing ones.
create or replace function public.vault_authorized(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    auth.role() = 'service_role'
    or public.is_admin()
    or exists (
      select 1 from public.client_platform_credentials c
      where c.vault_secret_id = p_id and public.owns_client(c.client_id)
    );
$$;
