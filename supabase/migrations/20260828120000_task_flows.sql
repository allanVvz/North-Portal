-- Fluxos em cascata — a terceira forma de um card ser "pai".
--
-- A casa já tinha duas: kind='plano_acao' agrega atividades (composição
-- manual) e recurrence_cadence agrega execuções (tempo). Falta a que agrega
-- etapas em SEQUÊNCIA: um criativo não é um card, é uma corrente de trabalhos
-- diferentes feitos por pessoas diferentes — Roteiro → Captação → Edição →
-- Publicação — onde cada etapa concluída materializa a próxima.
--
-- Seguindo docs/ARQUITETURA-TAREFAS.md ("Tudo que representa trabalho vive em
-- public.tasks. Não criar tabelas paralelas"), nenhuma tabela nova guarda
-- TRABALHO. As duas tabelas abaixo guardam o MOLDE — exatamente o papel que
-- commercial_checkpoint_templates já cumpre para os checkpoints comerciais, e
-- este arquivo espelha aquele de propósito (mesma forma de RLS, mesmo trigger
-- de updated_at, order_index sem unique para permitir reordenar sem swap).
--
-- O vínculo etapa→entrega reusa tasks.plan_id, que já é o FK estrutural de
-- pai/filho. O discriminador é limpo e não ambíguo:
--   * só a ENTREGA (pai) tem flow_template_id preenchido;
--   * só a ETAPA (filha) tem payload.flow_step_key preenchido.
-- Uma etapa NUNCA recebe flow_template_id — é o que impede árvore infinita,
-- o mesmo invariante que a recorrência já tem ("filho recorrente não herda
-- recorrência").

create table if not exists public.task_flow_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- step_key é a identidade ESTÁVEL da etapa dentro do molde, e é o que entra no
-- id determinístico do card (lib/derivedTaskId.ts). Precisa sobreviver a
-- renomear o título e a reordenar as etapas, senão a garantia de idempotência
-- do "card cria o próximo" cai junto. Daí o unique por (template, step_key) —
-- e nenhum unique em order_index, que é só apresentação.
create table if not exists public.task_flow_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_flow_templates(id) on delete cascade,
  step_key text not null,
  order_index int not null default 0,
  title text not null,
  kind text not null default 'criativo',
  subtype text,
  lead_days int not null default 0,
  progress_weight numeric not null default 1,
  default_assignee text,
  client_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, step_key)
);

create index if not exists task_flow_steps_template_order_idx
  on public.task_flow_steps (template_id, order_index);

drop trigger if exists set_updated_at on public.task_flow_templates;
create trigger set_updated_at before update on public.task_flow_templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.task_flow_steps;
create trigger set_updated_at before update on public.task_flow_steps
  for each row execute function public.set_updated_at();

alter table public.task_flow_templates enable row level security;
alter table public.task_flow_steps enable row level security;

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('task_flow_templates', 'task_flow_steps')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end$$;

-- Molde é config interna do admin. O portal do cliente nunca lê estas tabelas:
-- ele vê as ETAPAS (tasks client_visible), nunca o molde que as gerou.
create policy "task flow templates admin only" on public.task_flow_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "task flow steps admin only" on public.task_flow_steps
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- on delete set null (e não cascade): apagar um molde não pode apagar entregas
-- reais já em andamento. A entrega perde a referência ao molde mas mantém o
-- snapshot em payload.flow_total_weight, então o progresso continua correto.
alter table public.tasks
  add column if not exists flow_template_id uuid
    references public.task_flow_templates(id) on delete set null;

-- Índice parcial: só a entrega tem a coluna preenchida, e ela é uma fração
-- minúscula de tasks. tasks_plan_id_idx (20260706000008) já atende a busca das
-- etapas de uma entrega.
create index if not exists tasks_flow_template_id_idx
  on public.tasks (flow_template_id) where flow_template_id is not null;

-- Seed do molde "Criativo" — o fluxo que motivou a feature. Publicação é a
-- única etapa client_visible: o cliente acompanha quando a peça vai ao ar, não
-- a produção interna dela.
do $$
declare tpl uuid;
begin
  select id into tpl from public.task_flow_templates where name = 'Criativo';
  if tpl is null then
    insert into public.task_flow_templates (name, description)
      values ('Criativo', 'Roteiro → Captação → Edição → Publicação. Cada etapa concluída cria a próxima.')
      returning id into tpl;
    insert into public.task_flow_steps
      (template_id, step_key, order_index, title, kind, subtype, lead_days, client_visible) values
      (tpl, 'roteiro',    10, 'Roteiro',    'criativo', 'roteiro',    2, false),
      (tpl, 'captacao',   20, 'Captação',   'criativo', 'captacao',   3, false),
      (tpl, 'edicao',     30, 'Edição',     'criativo', 'edicao',     3, false),
      (tpl, 'publicacao', 40, 'Publicação', 'criativo', 'publicacao', 2, true);
  end if;
end$$;
