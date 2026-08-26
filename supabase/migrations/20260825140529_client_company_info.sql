-- "Dados da empresa" do cadastro de cliente (Figma 297:2, card 1).
-- Tabela filha 1:1, mesmo padrão de client_drive_links / client_results /
-- client_content: PK = client_id, cascade no delete, RLS owns_client / is_admin.
-- Vive fora de `clients` porque `clients` é a identidade mínima do tenant
-- (slug/nome/ativo) usada pelo middleware e pela RLS de todas as outras tabelas.

create table if not exists public.client_company_info (
  client_id uuid primary key references public.clients(id) on delete cascade,
  segmento text,
  cidade_uf text,
  instagram_ou_site text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.client_company_info;
create trigger set_updated_at before update on public.client_company_info
  for each row execute function public.set_updated_at();

alter table public.client_company_info enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'client_company_info'
  loop
    execute format('drop policy if exists %I on public.client_company_info', r.policyname);
  end loop;
end$$;

create policy "company info read own" on public.client_company_info
  for select to authenticated using (public.owns_client(client_id));
create policy "company info admin write" on public.client_company_info
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
