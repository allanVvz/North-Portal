-- Commercial checkpoint templates: the admin-configurable "mold" of which
-- commercial checkpoints exist by default (e.g. "Assinatura de contrato",
-- "Kickoff e onboarding"). Per-client instances are NOT stored here — they
-- live as normal `tasks` rows (kind='checkpoint_comercial'), auto-created
-- from this template list whenever a new client is provisioned. This table
-- is admin-only internal config, never read by the client portal.

create table if not exists public.commercial_checkpoint_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  order_index int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_checkpoint_templates_order_idx
  on public.commercial_checkpoint_templates (order_index);

drop trigger if exists set_updated_at on public.commercial_checkpoint_templates;
create trigger set_updated_at before update on public.commercial_checkpoint_templates
  for each row execute function public.set_updated_at();

alter table public.commercial_checkpoint_templates enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'commercial_checkpoint_templates'
  loop
    execute format('drop policy if exists %I on public.commercial_checkpoint_templates', r.policyname);
  end loop;
end$$;

create policy "checkpoint templates admin only" on public.commercial_checkpoint_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed the default checkpoint set (mirrors the static list that used to live
-- in portalData.ts, now backed by real tasks per client).
insert into public.commercial_checkpoint_templates (title, description, order_index) values
  ('Assinatura de contrato', 'Contrato assinado por ambas as partes.', 10),
  ('Kickoff e onboarding', 'Reunião de kickoff realizada e briefing preenchido.', 20),
  ('Roteiro e estratégia aprovados', 'Primeiro roteiro/copy entregue e aprovado pelo cliente.', 30),
  ('Primeira revisão de resultados', 'Primeira reunião de métricas após o início da operação.', 40)
on conflict do nothing;
