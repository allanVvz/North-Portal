-- "Plano & escopo" + "Responsável" do cadastro de cliente (Figma 297:2, cards 2 e 4).
-- Dados comerciais/contratuais numa tabela só porque são preenchidos no mesmo
-- passo e reajustados juntos (mudança de plano quase sempre mexe em escopo e valor).
--
-- `escopo` é jsonb e não text[] porque um item de escopo pode carregar uma
-- quantidade — o chip "3 Carrosséis" do Figma. Formato:
--   [{"key":"social_media"}, {"key":"carrosseis","quantity":3}]
-- As chaves referenciam public.scope_tags.key (catálogo editável pelo admin).
--
-- `plano_tier` não tem CHECK de propósito: o vocabulário é validado em Zod
-- (PLANO_TIERS em lib/validation.ts), mesma decisão já tomada para tasks.kind —
-- adicionar um plano é mudança de código, não migration.

create table if not exists public.client_contract (
  client_id uuid primary key references public.clients(id) on delete cascade,
  plano_tier text,
  escopo jsonb not null default '[]'::jsonb,
  valor_mensal numeric(12,2),
  contract_start date,
  responsavel_nome text,
  responsavel_whatsapp text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.client_contract;
create trigger set_updated_at before update on public.client_contract
  for each row execute function public.set_updated_at();

alter table public.client_contract enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'client_contract'
  loop
    execute format('drop policy if exists %I on public.client_contract', r.policyname);
  end loop;
end$$;

create policy "contract read own" on public.client_contract
  for select to authenticated using (public.owns_client(client_id));
create policy "contract admin write" on public.client_contract
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
