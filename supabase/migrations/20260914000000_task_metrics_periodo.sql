-- Período reportado de uma linha de métricas — o que transforma task_metrics
-- numa série temporal de verdade.
--
-- Sem isto, a linha só sabe QUANDO a automação rodou (`created_at`), não A QUAL
-- semana o número se refere — e "seguidores ao longo do tempo" precisa da
-- segunda pergunta, não da primeira: uma re-execução, um comentário corrigido
-- dias depois ou um backfill deslocam `created_at` sem deslocar o período
-- reportado, e a série sairia torta.
--
-- Nulável de propósito: os outros caminhos que escrevem aqui (métricas
-- digitadas à mão num card publicado, sync do Meta/Windsor) não têm noção de
-- período — só o fluxo de conversão (Automação 2) preenche.
alter table public.task_metrics
  add column if not exists period_from date,
  add column if not exists period_to date;

-- A consulta da série é sempre "deste cliente, em ordem de período" — tanto
-- para o comparativo da semana anterior no PDF quanto para qualquer gráfico
-- de evolução depois.
create index if not exists task_metrics_client_period_idx
  on public.task_metrics (client_id, period_to desc)
  where period_to is not null;
