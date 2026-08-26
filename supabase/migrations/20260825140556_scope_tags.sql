-- Catálogo de tags de "Escopo contratado" (Figma 297:2, card "Plano & escopo").
-- Fica no banco, e não num catálogo em código como lib/taskCatalog.ts, porque o
-- admin cria tags novas direto do formulário (chip "+ Nova tag") — precisa valer
-- na hora, sem deploy. Só o admin lê/escreve: o portal do cliente nunca consulta
-- esta tabela (ele recebe os rótulos já resolvidos no conteúdo do portal).

create table if not exists public.scope_tags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  has_quantity boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.scope_tags enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'scope_tags'
  loop
    execute format('drop policy if exists %I on public.scope_tags', r.policyname);
  end loop;
end$$;

create policy "scope tags admin all" on public.scope_tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed: as 6 tags desenhadas no Figma. has_quantity só em carrosseis
-- (o chip "3 Carrosséis" é o único que carrega número).
insert into public.scope_tags (key, label, has_quantity) values
  ('social_media', 'Social media', false),
  ('criativos',    'Criativos',    false),
  ('trafego_pago', 'Tráfego pago', false),
  ('captacao',     'Captação',     false),
  ('carrosseis',   'Carrosséis',   true),
  ('branding',     'Branding',     false)
on conflict (key) do nothing;
