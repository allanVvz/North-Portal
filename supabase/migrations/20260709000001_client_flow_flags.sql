-- Per-client feature flags for the Revisão/Aprovação flows: each stage can be
-- switched off independently for admin and for cliente. Turning admin off for
-- a stage always forces cliente off too (enforced here as a defensive check
-- AND in the application layer, which also cascades the write and moves any
-- card currently sitting in that stage back to "em_producao"). Absence of a
-- row means every flag is on (today's behavior, unchanged for existing
-- clients until they're explicitly configured).

create table if not exists public.client_flow_flags (
  client_id uuid primary key references public.clients(id) on delete cascade,
  revisao_admin boolean not null default true,
  revisao_cliente boolean not null default true,
  aprovacao_admin boolean not null default true,
  aprovacao_cliente boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint revisao_cliente_requires_admin check (revisao_admin or not revisao_cliente),
  constraint aprovacao_cliente_requires_admin check (aprovacao_admin or not aprovacao_cliente)
);

drop trigger if exists set_updated_at on public.client_flow_flags;
create trigger set_updated_at before update on public.client_flow_flags
  for each row execute function public.set_updated_at();

alter table public.client_flow_flags enable row level security;

create policy "flowflags read own" on public.client_flow_flags
  for select to authenticated using (public.owns_client(client_id));
create policy "flowflags admin write" on public.client_flow_flags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
