-- Admin "Configurações": legal documents (Políticas) + generic site settings.
-- legal_docs feed the public Política/Termos/Cookies pages, so they are readable
-- by everyone (anon); only admins write. site_settings is admin-only (agency profile).

create table if not exists public.legal_docs (
  slug text primary key,
  title text not null,
  body text not null default '',
  status text not null default 'rascunho' check (status in ('rascunho','publicada')),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.legal_docs;
create trigger set_updated_at before update on public.legal_docs
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.site_settings;
create trigger set_updated_at before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.legal_docs enable row level security;
alter table public.site_settings enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('legal_docs','site_settings')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end$$;

-- legal docs: everyone reads (feeds public pages), admin writes
create policy "legal read all" on public.legal_docs for select using (true);
create policy "legal admin write" on public.legal_docs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- site settings: admin only
create policy "settings admin all" on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.legal_docs (slug, title, body, status) values
  ('privacidade', 'Política de Privacidade', 'Conteúdo da Política de Privacidade (LGPD). Edite no admin.', 'publicada'),
  ('termos', 'Termos de Uso', 'Conteúdo dos Termos de Uso. Edite no admin.', 'publicada'),
  ('cookies', 'Política de Cookies', 'Conteúdo da Política de Cookies. Edite no admin.', 'publicada')
on conflict (slug) do nothing;
