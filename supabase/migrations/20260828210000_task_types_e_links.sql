-- Rodada 2 dos fluxos: um vocabulário só e um mecanismo de vínculo só.
--
-- A rodada 1 criou `task_flow_templates` + `task_flow_steps` ao lado do
-- catálogo em código, e as duas coisas descrevem o mesmo: que tipos de card
-- existem e como eles se subdividem. Um fluxo É um tipo; suas etapas SÃO os
-- subtipos dele. Aqui as duas tabelas viram uma, auto-referenciada — linha sem
-- pai é Tipo, linha com pai é Subtipo.
--
-- E o vínculo entre cards passa de 1:1 para N:N. A operação precisa de um mesmo
-- roteiro servindo várias peças e de uma diária de gravação servindo vários
-- criativos; `tasks.plan_id` não expressa isso, e já tinha precisado do
-- workaround `payload.action_plan_id` justamente porque um card podia ter dois
-- pais. É o "grafo geral de relações" que 20260706000008_task_model_v2.sql
-- deixou explicitamente para depois.

-- ---------------------------------------------------------------------------
-- 1. task_types — o vocabulário inteiro em uma tabela
-- ---------------------------------------------------------------------------

create table if not exists public.task_types (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.task_types(id) on delete cascade,
  key text not null,
  label text not null,
  order_index int not null default 0,
  -- O único botão de comportamento. 'entrega' cascateia pelos subtipos na
  -- ordem; 'plano' agrega por composição manual; 'simples' é card comum.
  behavior text not null default 'simples' check (behavior in ('entrega', 'plano', 'simples')),
  -- false = existe só por provisionamento automático e não aparece no
  -- dropdown de Tipo (checkpoint_comercial nasce na criação do cliente).
  creatable boolean not null default true,
  active boolean not null default true,
  -- Só fazem sentido em subtipo de um tipo 'entrega': como a etapa nasce.
  lead_days int not null default 0,
  progress_weight numeric not null default 1,
  default_assignee text,
  client_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_id, key)
);

-- `unique (parent_id, key)` NÃO cobre os tipos raiz: em Postgres dois NULL são
-- distintos, então dois tipos com a mesma key e parent_id nulo passariam. O
-- índice parcial fecha isso.
create unique index if not exists task_types_root_key_idx
  on public.task_types (key) where parent_id is null;
create index if not exists task_types_parent_order_idx
  on public.task_types (parent_id, order_index);

drop trigger if exists set_updated_at on public.task_types;
create trigger set_updated_at before update on public.task_types
  for each row execute function public.set_updated_at();

alter table public.task_types enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'task_types'
  loop execute format('drop policy if exists %I on public.task_types', r.policyname); end loop;
end$$;

-- Vocabulário é config interna do admin: o portal do cliente vê os CARDS, não
-- a tabela que os classifica.
create policy "task types admin only" on public.task_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed espelhando lib/taskCatalog.ts, que continua sendo a fonte do visual
-- (tom, ícone) e do progresso (workflow). Esta tabela é a fonte do VOCABULÁRIO.
do $$
declare t uuid;
begin
  -- Operacional: o tipo mais usado (131 cards), default da criação.
  insert into public.task_types (key, label, order_index, behavior)
    values ('operacional', 'Operacional', 10, 'simples')
    on conflict do nothing;
  select id into t from public.task_types where key = 'operacional' and parent_id is null;
  insert into public.task_types (parent_id, key, label, order_index) values
    -- Gestão vem primeiro porque é o subtipo default de Operacional.
    (t, 'gestao', 'Gestão', 0),
    (t, 'relatorio_trafego', 'Relatório de tráfego', 10)
    on conflict do nothing;

  -- Criativo: o tipo-entrega. Seus subtipos são as etapas da cascata.
  insert into public.task_types (key, label, order_index, behavior)
    values ('criativo', 'Criativo', 20, 'entrega')
    on conflict do nothing;
  select id into t from public.task_types where key = 'criativo' and parent_id is null;
  insert into public.task_types (parent_id, key, label, order_index, lead_days, client_visible) values
    (t, 'roteiro', 'Roteiro', 10, 2, false),
    (t, 'captacao', 'Captação', 20, 3, false),
    (t, 'edicao', 'Edição', 30, 3, false),
    -- Publicação é a única etapa que o cliente acompanha: ele quer saber
    -- quando a peça vai ao ar, não como ela foi produzida.
    (t, 'publicacao', 'Publicação', 40, 2, true)
    on conflict do nothing;

  insert into public.task_types (key, label, order_index, behavior)
    values ('plano_acao', 'Plano de Ação', 30, 'plano')
    on conflict do nothing;

  insert into public.task_types (key, label, order_index, behavior)
    values ('agendamento', 'Agendamento', 40, 'simples')
    on conflict do nothing;
  select id into t from public.task_types where key = 'agendamento' and parent_id is null;
  insert into public.task_types (parent_id, key, label, order_index) values
    (t, 'gravacao', 'Gravação', 10),
    (t, 'visita_comercial', 'Visita comercial', 20),
    (t, 'reuniao_alinhamento', 'Reunião de alinhamento', 30),
    (t, 'publicacao', 'Publicação', 40),
    (t, 'apresentacao_resultados', 'Apresentação de resultados', 50)
    on conflict do nothing;

  insert into public.task_types (key, label, order_index, behavior)
    values ('planejamento', 'Planejamento', 50, 'simples')
    on conflict do nothing;
  select id into t from public.task_types where key = 'planejamento' and parent_id is null;
  insert into public.task_types (parent_id, key, label, order_index) values
    (t, 'briefing', 'Briefing', 10),
    (t, 'roteiro', 'Roteiro', 20),
    (t, 'definicao_pauta', 'Definição de pauta', 30),
    (t, 'busca_referencias', 'Busca de referências', 40),
    (t, 'checklist_gravacao', 'Checklist de gravação', 50),
    (t, 'copy_legenda', 'Copy / legenda', 60),
    (t, 'organizacao_pastas', 'Organização de pastas', 70)
    on conflict do nothing;

  -- Fora do dropdown: nasce em provisionCheckpointsForClient, ninguém cria à
  -- mão. Hoje ele aparece como opção criável na tela Tarefas, o que é um bug.
  insert into public.task_types (key, label, order_index, behavior, creatable)
    values ('checkpoint_comercial', 'Checkpoint Comercial', 60, 'simples', false)
    on conflict do nothing;
end$$;

-- ---------------------------------------------------------------------------
-- 2. task_links — pertencimento N:N, o mesmo para plano e para entrega
-- ---------------------------------------------------------------------------

create table if not exists public.task_links (
  parent_id uuid not null references public.tasks(id) on delete cascade,
  child_id  uuid not null references public.tasks(id) on delete cascade,
  -- Em uma entrega, qual etapa (key do subtipo) este filho ocupa. Null em
  -- membro de Plano de Ação, que não tem posição fixa.
  slot text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  primary key (parent_id, child_id),
  -- Um card não pode ser pai de si mesmo; sem isso, um clique errado cria um
  -- ciclo de rollup que só a guarda em taskProgress salvaria.
  constraint task_links_no_self check (parent_id <> child_id)
);

create index if not exists task_links_child_idx on public.task_links (child_id);
create index if not exists task_links_parent_slot_idx on public.task_links (parent_id, slot);

alter table public.task_links enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'task_links'
  loop execute format('drop policy if exists %I on public.task_links', r.policyname); end loop;
end$$;

create policy "task links admin all" on public.task_links
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- O portal do cliente lê os elos para montar o Plano de Ação: ele precisa
-- enxergar a ligação entre um plano visível e suas atividades visíveis. A RLS
-- de `tasks` continua sendo quem decide o que ele vê de fato.
create policy "task links client read" on public.task_links
  for select to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_links.parent_id
        and t.client_visible
        and t.client_id = public.current_client_id()
    )
  );

-- Backfill. Duas origens, e uma exclusão que é o ponto todo da mudança:
--   * payload.action_plan_id — o workaround do card com dois pais;
--   * plan_id, QUANDO não é uma ocorrência de recorrência.
-- Ocorrência recorrente continua em plan_id: essa relação é 1:1 por natureza
-- (uma execução pertence a um pai recorrente e só), e mexer nela arrastaria
-- toda a máquina de ciclos junto sem ganho nenhum.
insert into public.task_links (parent_id, child_id, slot, position)
select
  coalesce(t.payload->>'action_plan_id', t.plan_id::text)::uuid,
  t.id,
  t.payload->>'flow_step_key',
  t.position
from public.tasks t
where coalesce(t.payload->>'action_plan_id', t.plan_id::text) is not null
  and not (t.payload ? 'recurrence_parent_id')
  -- Um dado legado apontando para si mesmo violaria task_links_no_self e
  -- derrubaria a migration inteira; descartar é o comportamento certo.
  and coalesce(t.payload->>'action_plan_id', t.plan_id::text) <> t.id::text
  and exists (
    select 1 from public.tasks p
    where p.id = coalesce(t.payload->>'action_plan_id', t.plan_id::text)::uuid
  )
on conflict do nothing;

-- Membro de plano deixa de morar em plan_id; a partir daqui plan_id significa
-- exclusivamente "ocorrência de uma recorrência".
update public.tasks t
set plan_id = null
where t.plan_id is not null
  and not (t.payload ? 'recurrence_parent_id')
  and exists (select 1 from public.task_links l where l.child_id = t.id);

update public.tasks
set payload = payload - 'action_plan_id'
where payload ? 'action_plan_id';

-- ---------------------------------------------------------------------------
-- 3. A entrega passa a ser marcada no payload, não por coluna
-- ---------------------------------------------------------------------------

-- Marcar ANTES de dropar a coluna, senão a informação se perde.
--
-- Por que uma marca explícita e não "criativo sem subtipo": existem 43 cards
-- `criativo` legados com subtype nulo, de antes dos fluxos. Inferir entrega a
-- partir do tipo faria todos eles virarem pais de uma hora para outra —
-- sumiriam do quadro Tarefas (belongsToTaskScreen exclui pais) e passariam a
-- marcar 0% com quatro etapas faltando. A marca segue o precedente que a
-- recorrência já usa para a mesma pergunta: payload.recurrence_group.
update public.tasks
set payload = payload || '{"flow_parent": true}'::jsonb
where flow_template_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Some o que a rodada 1 tinha criado
-- ---------------------------------------------------------------------------

drop index if exists public.tasks_flow_template_id_idx;
alter table public.tasks drop column if exists flow_template_id;
drop table if exists public.task_flow_steps;
drop table if exists public.task_flow_templates;
