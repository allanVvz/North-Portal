-- Trilhas North: a LISTA GLOBAL de material educacional do portal.
--
-- Antes: o admin "gerenciava" trilhas filtrando a tabela `documents` por HTML
-- (`DocumentsTable variant="trilhas"`), e `documents.client_id` é NOT NULL, então
-- cada "trilha" era por cliente. O portal do cliente, por outro lado, renderizava
-- `content.trilhas.items` — um array escrito à mão nos defaults do Figma
-- (`app/[slug]/portalData.ts`), que nem era editável. Os dois lados não se
-- conversavam: o que o admin subia não aparecia para ninguém.
--
-- Agora existe UMA lista, igual para todos os clientes. O admin adiciona uma
-- apresentação HTML (subida no bucket `documents`, num path `north-trilhas/...`)
-- ou um vídeo do YouTube (só o id), reordena por arraste (`position`), e o
-- `TrilhasPage` do portal lê exatamente essa lista, na mesma ordem.
--
-- O "Manual do Cliente" (deck de 11 slides hardcoded em ManualDoCliente.tsx, que
-- move o % de onboarding) vira a linha `kind='manual'` — semeada, única, o admin
-- vê e reordena mas não apaga nem troca o tipo. `manual_seen` continua vindo de
-- `client_prefs`; progresso por trilha dos outros itens é uma fase seguinte.

create table if not exists public.north_trilhas (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('slides_html', 'video_youtube', 'manual')),
  title text not null,
  description text not null default '',
  etapa text not null default '',
  position int not null default 0,
  storage_path text,   -- slides_html: caminho no bucket `documents`
  file_url text,        -- slides_html: URL pública derivada do storage_path
  youtube_id text,      -- video_youtube: só o id (ex.: "dQw4w9WgXcQ")
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists north_trilhas_position_idx on public.north_trilhas (position);

-- Só pode existir UMA linha 'manual' — o Manual do Cliente é único.
create unique index if not exists north_trilhas_one_manual
  on public.north_trilhas (kind) where kind = 'manual';

drop trigger if exists set_updated_at on public.north_trilhas;
create trigger set_updated_at before update on public.north_trilhas
  for each row execute function public.set_updated_at();

alter table public.north_trilhas enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'north_trilhas'
  loop
    execute format('drop policy if exists %I on public.north_trilhas', r.policyname);
  end loop;
end$$;

-- Todo usuário autenticado (todo cliente + admin) lê a mesma lista global.
create policy "north trilhas read" on public.north_trilhas
  for select to authenticated using (true);

-- Só admin escreve.
create policy "north trilhas admin write" on public.north_trilhas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Semeia a linha do Manual do Cliente (idempotente pelo índice único parcial).
insert into public.north_trilhas (kind, title, description, etapa, position)
values (
  'manual',
  'Manual do Cliente',
  'Como funciona a parceria com a North, o que esperar de cada etapa e como aproveitar o portal.',
  'Jornada',
  0
)
on conflict do nothing;
