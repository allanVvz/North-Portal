-- Cargo (tag livre, exibida em Equipe & papéis e usada como gate de
-- visibilidade em "Quem Somos": qualquer perfil com cargo preenchido aparece
-- lá — não é enum, não carrega regra de permissão nenhuma, só decide quem é
-- público), bio (texto livre, mesma origem que alimenta a descrição em Quem
-- Somos) e avatar_url (substitui o mock em localStorage de MyAccountForm).
alter table public.profiles
  add column if not exists cargo text,
  add column if not exists bio text,
  add column if not exists avatar_url text;

-- Bucket de avatar — mesmo padrão do bucket 'documents' já em produção
-- (20260814000002_documents_storage.sql): público para preservar o fluxo de
-- URL direta, escrita restrita a admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars storage admin insert" on storage.objects;
drop policy if exists "avatars storage admin update" on storage.objects;
drop policy if exists "avatars storage admin delete" on storage.objects;

create policy "avatars storage admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_admin());

create policy "avatars storage admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.is_admin())
  with check (bucket_id = 'avatars' and public.is_admin());

create policy "avatars storage admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.is_admin());

-- Responsabilidades: quem cuida de qual frente. Tabela pequena e
-- muitos-para-muitos de propósito — sem automação ligada ainda (nenhuma
-- sugestão de revisor, nenhuma notificação nova nesta rodada), só desenhada
-- para não exigir retrabalho se isso um dia alimentar algo automático.
create table if not exists public.responsibility_assignments (
  responsibility text not null check (responsibility in ('edicao', 'captacao', 'roteiro', 'metricas', 'aprovacao')),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (responsibility, profile_id)
);
alter table public.responsibility_assignments enable row level security;

drop policy if exists "responsibility admin all" on public.responsibility_assignments;
create policy "responsibility admin all" on public.responsibility_assignments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Seed: os 3 C-levels + as 5 responsabilidades, como descrito.
update public.profiles set cargo = 'CEO', bio = 'Direção geral e captação de clientes.' where full_name = 'Alisson' and cargo is null;
update public.profiles set cargo = 'COO', bio = 'Operação e aprovação de entregas.' where full_name = 'Cintia' and cargo is null;
update public.profiles set cargo = 'CFO', bio = 'Roteiro, métricas e aprovação de entregas.' where full_name = 'Luiza' and cargo is null;

insert into public.responsibility_assignments (responsibility, profile_id)
select 'edicao', id from public.profiles where full_name in ('Allan', 'Alisson')
union all
select 'captacao', id from public.profiles where full_name = 'Alisson'
union all
select 'roteiro', id from public.profiles where full_name = 'Luiza'
union all
select 'metricas', id from public.profiles where full_name = 'Luiza'
union all
select 'aprovacao', id from public.profiles where full_name in ('Luiza', 'Cintia')
on conflict do nothing;
