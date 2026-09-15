-- Fonte de verdade estruturada para as duas pipelines de relatório, e a
-- dependência entre elas declarada no schema. Ver
-- docs/audits/report-automation-flow.md (achados A1, A2, A3, A6).
--
-- Até aqui o relatório de ANÚNCIOS não deixava nada atrás de si além do PDF: as
-- métricas eram buscadas na API na hora de renderizar e se perdiam. Isso tinha
-- três consequências: (a) regerar a mesma semana falhava — nome de arquivo fixo
-- e upsert:false; (b) o relatório de VENDAS buscava a API de novo para a mesma
-- semana, e os dois PDFs podiam divergir; (c) não havia "revisão final" a que a
-- segunda pipeline pudesse se prender, então ela rodava sobre um relatório ainda
-- em revisão humana.
--
-- Não substitui nada: `documents` continua sendo o artefato (o PDF) e
-- `task_metrics` continua sendo a série por card. Estas tabelas são o registro
-- do que foi gerado, de qual revisão, a partir de que dados — e a ligação entre
-- as duas pipelines.

-- ---- traffic_reports ---------------------------------------------------------
create table if not exists public.traffic_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- O card que recebeu o PDF (a etapa `trafego` no modo fluxo, ou a ocorrência /
  -- o próprio card no modo simples).
  task_id uuid not null references public.tasks(id) on delete cascade,
  -- O pai do fluxo desta semana, quando há fluxo. É por aqui que a Automação 2
  -- encontra o relatório de anúncios da mesma ocorrência.
  occurrence_id uuid references public.tasks(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  revision integer not null default 1 check (revision >= 1),
  -- Os posts de campanha/anúncio do período (e do período anterior) exatamente
  -- como foram usados no PDF. É o que a Automação 2 lê em vez de refazer a busca.
  snapshot jsonb not null default '{}'::jsonb,
  -- generated: PDF pronto, ainda pode estar em revisão humana.
  -- finalized: é esta a revisão sobre a qual a Automação 2 pode trabalhar.
  -- superseded: uma revisão mais nova a substituiu.
  status text not null default 'generated' check (status in ('generated', 'finalized', 'superseded')),
  document_id uuid references public.documents(id) on delete set null,
  generated_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (task_id, revision)
);

create index if not exists traffic_reports_occurrence_idx
  on public.traffic_reports (occurrence_id) where occurrence_id is not null;
create index if not exists traffic_reports_client_period_idx
  on public.traffic_reports (client_id, period_to desc);

alter table public.traffic_reports enable row level security;
drop policy if exists "traffic reports admin all" on public.traffic_reports;
create policy "traffic reports admin all" on public.traffic_reports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- conversion_reports ------------------------------------------------------
create table if not exists public.conversion_reports (
  id uuid primary key default gen_random_uuid(),
  -- A revisão FINAL do relatório de anúncios sobre a qual este foi gerado. Uma
  -- revisão nova do tráfego não reescreve este vínculo — gera outro registro.
  traffic_report_id uuid not null references public.traffic_reports(id) on delete cascade,
  feedback_task_id uuid not null references public.tasks(id) on delete cascade,
  -- Carimbo `at` do comentário lido (é o id estável que um comentário tem).
  -- Nulo quando a semana fechou sem retorno do responsável.
  source_comment_at text,
  mode text not null check (mode in ('followers_only', 'sales_summary', 'sales_segmented', 'no_data')),
  -- Só as métricas informadas: chave ausente = não informado (nunca 0).
  conversion_metrics jsonb not null default '{}'::jsonb,
  -- Cobertura de atribuição e totais por origem (#1/#2/#3).
  attribution jsonb not null default '{}'::jsonb,
  -- Como o comentário foi lido: "regex", "llm", "IA indisponível: …".
  parser text not null default '',
  status text not null default 'generated' check (status in ('generated', 'finalized')),
  document_id uuid references public.documents(id) on delete set null,
  generated_at timestamptz not null default now()
);

-- Idempotência: o mesmo comentário, sobre a mesma revisão do tráfego, gera UM
-- relatório de vendas — retry de worker, cron em dobro ou webhook duplicado
-- batem aqui em vez de anexar um segundo PDF.
create unique index if not exists conversion_reports_idempotency_idx
  on public.conversion_reports (feedback_task_id, traffic_report_id, coalesce(source_comment_at, ''));

alter table public.conversion_reports enable row level security;
drop policy if exists "conversion reports admin all" on public.conversion_reports;
create policy "conversion reports admin all" on public.conversion_reports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- automation_configs.depends_on_config_id --------------------------------
-- A cascata passa a ser um atributo, não uma dedução. Até aqui a Automação 2
-- "dependia" da 1 porque as duas apontavam para o mesmo card — e a ordem de
-- execução era garantida por um sort() em memória no cron.
alter table public.automation_configs
  add column if not exists depends_on_config_id uuid
  references public.automation_configs(id) on delete set null;

-- As 6 configurações de relatorio_vendas existentes passam a declarar a
-- automação de anúncios com que já conviviam no mesmo card. É fiação de
-- configuração, não dado de tarefa.
update public.automation_configs v
   set depends_on_config_id = t.id
  from public.automation_configs t
 where v.automation_key = 'relatorio_vendas'
   and t.automation_key = 'relatorio_trafego_semanal'
   and t.target_task_id = v.target_task_id
   and v.depends_on_config_id is null;
