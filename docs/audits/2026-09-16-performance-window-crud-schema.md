# Auditoria de CRUD, janelas temporais e schema

Data: 2026-09-16

## Escopo verificado

Foram revisados o fluxo de Performance, os CRUDs de tarefas, as 96 migrations
existentes no início da auditoria e o schema remoto do projeto ligado por uma
consulta somente leitura à Management API.

O schema remoto está em PostgreSQL 17.6 e possui 31 tabelas, 287 colunas, 78
índices, 117 constraints, 72 policies RLS e 32 funções no schema `public`.

Limite importante: este repositório não contém domínio de GPS/mapa/journey
espacial. O único trace existente é a série temporal do dashboard de
Performance em `app/admin/performance/charts/TrendChart.tsx`. Portanto, zoom,
LOD, pontos interpolados e janelas estacionárias descritos abaixo são uma nova
capacidade para essa série. Se a solicitação se referia a trajetos físicos, o
repositório ou branch correto ainda precisa ser identificado.

## Diagnóstico principal: por que 3 dias já demoram

O problema não é a quantidade de pontos desenhada pelo Recharts. O caminho de
leitura faz trabalho desproporcional antes de renderizar:

1. O frontend pede período atual + período anterior. Uma visão de 3 dias começa
   como uma consulta de 6 dias.
2. Um cache ausente ou expirado sempre baixa 90 dias, independentemente do
   intervalo solicitado.
3. Mesmo com filtro de cliente, a rota monta providers para todas as contas,
   resolve clientes em loops seriais e só filtra o resultado no final.
4. `meta_insights_cache` guarda um JSONB por `(account_id, datasource)`. A
   leitura traz todos os blobs de todas as contas e filtra em memória.
5. O teste de cache fresco valida `date_from <= from`, mas não valida
   `date_to >= to`; uma cobertura incompleta pode ser tratada como válida.
6. Uma consulta histórica fora dos 90 dias recentes tenta reencher novamente
   a janela móvel recente, não a janela pedida.
7. O drill-down dispara duas requests por campanha (`adset` e `ad`) sem limite
   de concorrência. As automações de relatório repetem fetches externos e não
   reutilizam o cache do dashboard.

No banco remoto há somente 30 linhas de cache, mas elas já ocupam cerca de
1,06 MB de tabela, 492.546 bytes de payload JSONB e 3.076 itens. Isso explica a
latência com poucos dados: o custo fixo de rede externa, desserialização global
e fan-out domina a consulta curta. Para um mês e mais contas, o desenho cresce
por payload, conta, datasource e campanha ao mesmo tempo.

## Erros e inconsistências do schema atual

### P0

- `task_metrics.task_id` é `UNIQUE`, mas a tabela recebeu `period_from` e
  `period_to` com a intenção de virar série temporal. O UPSERT continua usando
  apenas `task_id`, então a coleta seguinte sobrescreve a anterior. Hoje não há
  histórico recuperável por zoom.
- A migration `20260916190000_relatorio_entrega_northia.sql` abortava um banco
  novo se não existisse um profile admin chamado `Luiza`. Usuários Auth são
  criados depois das migrations, então `db reset`, CI e preview não eram
  reproduzíveis. A migration foi ajustada para fazer o backfill somente quando
  o perfil existir.
- O histórico de migrations está desalinhado: após criar as duas migrations
  desta auditoria existem 98 versões locais e 95 remotas, com 65 IDs somente
  locais e 62 somente remotos. Grande parte parece ser renomeação histórica do
  mesmo conteúdo, mas o CLI compara versões. Não executar `db push` até
  reconciliar o histórico com `migration repair`/baseline controlado.

### P1

- Existe 1 vínculo em `task_links` entre tarefas de clientes diferentes. Não há
  ciclos nem slots duplicados hoje, mas o banco anteriormente não impedia esses
  estados.
- `task_metrics.client_id` é duplicado de `tasks.client_id` e não tinha garantia
  de consistência. A policy de coleta confiava no valor enviado no filho.
- Advisors remotos: 40 avisos de performance (22 policies permissivas
  sobrepostas, 8 FKs sem índice, 6 RLS sem InitPlan e 4 índices ainda sem uso) e
  27 avisos de segurança (principalmente funções `SECURITY DEFINER` executáveis
  por `authenticated`/`anon`). Nem toda função é vulnerável — várias são RPCs
  intencionais —, mas cada uma precisa de revisão de autorização e `EXECUTE`.
- O CRUD de tarefas retorna feeds completos, sem cursor, com `payload` JSONB e
  relações embutidas. `listAllTasks()` ainda filtra pais/clientes desativados em
  memória. O custo cresce com comentários e histórico, não só com cards.
- Faltavam índices para várias FKs, confirmados pelo advisor, e índices compostos
  alinhados às ordenações reais do board e das telas de pais.
- `task_links` fazia validação de slot no padrão SELECT-depois-INSERT, sujeito a
  corrida. Também não havia proteção contra ciclos ou elo cross-client.

### P2

- Não havia constraints para intervalos invertidos em tarefas, agenda,
  métricas, cache e relatórios.
- O schema de query aceita `from > to` e não limita amplitude.
- A paginação da Meta para em 40 páginas sem transformar o truncamento em erro.
- `trendSeries()` transforma ausência de coleta em zero. Zero real, missing e
  stale ficam indistinguíveis.
- O gráfico usa curva `monotone`, não possui Brush/zoom e nunca mostra dots
  normais (`dot={false}`). Não existe protocolo de resolução/LOD.

## Correções imediatas no caminho atual

Antes do cutover para points/rollups, a rota atual foi ajustada para:

- resolver todos os slugs de cliente em uma única consulta;
- limitar a leitura do cache às contas mapeadas quando há filtro de cliente;
- não montar providers Meta de outros clientes;
- validar também `date_to >= to` antes de considerar o cache fresco;
- buscar no provider exatamente `[from, to]`, em vez de 90 dias fixos;
- descartar, antes do UPSERT, contas Windsor fora do filtro solicitado.

Isso reduz o custo da visão curta imediatamente. Windsor ainda devolve todas as
contas do datasource na chamada externa porque o conector atual não recebe
filtro de conta; a filtragem antecipada evita persistência e resposta extras,
mas a solução definitiva continua sendo ingestão assíncrona por chunks.

## Migrations produzidas

### `20260916232701_optimize_crud_and_schema_hot_paths.sql`

- índices compostos/parciais para board, pais de fluxo, links e FKs;
- unicidade parcial de `(parent_id, slot)`;
- trigger para impedir novos elos cross-client e ciclos;
- constraints temporais `NOT VALID`, que protegem novas escritas sem bloquear
  o deploy por eventual legado;
- trigger que mantém `task_metrics.client_id = tasks.client_id`;
- policies de `task_metrics`, cache, relatórios, templates, leads,
  `task_assignees` e `task_links` com InitPlan e menos sobreposição permissiva.

O vínculo cross-client existente não foi apagado automaticamente. É dado de
negócio e precisa ser revisado antes de uma correção destrutiva.

### `20260916232706_add_performance_trace_windows.sql`

Cria uma base de cutover sem remover o cache legado:

- `performance_trace_points`: observações brutas append-only para zoom;
- `performance_trace_rollups`: envelope persistido first/min/max/last por
  bucket, preservando picos e forma do trace;
- `performance_trace_stationary_windows`: intervalos estáveis com tolerâncias
  absoluta/relativa registradas;
- `performance_trace_chunks`: cobertura, status, cursor, tentativas e erro de
  ingestão por janela;
- índices por tenant/série/tempo, constraints, grants explícitos e RLS.

Não houve backfill automático do JSONB: o payload legado mistura níveis e
formatos de provider. O backfill deve passar pelo mesmo normalizador da nova
ingestão e ser feito em lotes idempotentes.

## Estratégia de consulta em batches/janelas

### Ingestão

1. Retirar fetch Meta/Windsor do request que renderiza a tela.
2. Um cron/worker sincroniza chunks alinhados (sugestão inicial: 7 dias), com no
   máximo 4–6 chamadas simultâneas por provider e backoff para 429/5xx.
3. Gravar pontos em batch com UPSERT pela chave natural da série.
4. Marcar cada chunk como `ready`, `partial` ou `failed`; nunca esconder o limite
   de páginas.
5. Reusar o mesmo repositório de pontos nas automações de PDF.

### Leitura

1. A API recebe janela, filtros e `maxPoints` calculado pela largura do gráfico.
2. Aplicar tenant/conta antes de montar providers ou consultar pontos.
3. Se a quantidade esperada couber no orçamento, retornar raw. Caso contrário,
   escolher a resolução mais fina cujo número de buckets caiba no orçamento.
4. Buscar somente chunks que intersectam `[from, to]`; prefetch do chunk
   anterior/próximo pode ocorrer em background.
5. Para métricas de razão (CTR, CPC, CPM, frequência), agregar volumes base e
   recalcular a razão. Nunca tirar média simples de razões.

### Interpolação e simplificação

- Preservar bruto. Salvar somente o trace reduzido destruiria o detalhe do zoom.
- Em visão ampla, usar envelope first/min/max/last e opcionalmente LTTB dentro
  do orçamento de pixels.
- Não simplificar cruzando gaps, mudança de conta/campanha/plataforma ou janela
  sem observação.
- Interpolação é somente visual e deve carregar `estimated=true`; não entra em
  KPI, rollup ou detecção de estabilidade.
- Ausência deve ser `null`/gap, não zero. Para contadores acumulados, definir
  explicitamente quando `step` é mais correto que `linear`.

### Janelas paradas

Uma run é estável quando, para pontos observados consecutivos:

`abs(delta) <= absoluteEpsilon + relativeEpsilon * max(abs(a), abs(b))`

Consolidar somente se houver pelo menos 2 pontos e nenhum gap acima do máximo da
fonte. Persistir início, fim, min, max, maior delta, amostras e epsilons usados.
No zoom, mostrar pontos observados; fora do zoom, desenhar o trace LOD e a faixa
estável, sem centenas de dots.

## Sequência recomendada de entrega

1. Reconciliar o histórico local/remoto de migrations.
2. Revisar o vínculo cross-client e advisors de segurança antes de aplicar DDL.
3. Aplicar a migration de hot paths; rodar advisors e `EXPLAIN (ANALYZE,
   BUFFERS)` sob papéis admin e cliente.
4. Aplicar tabelas de trace e implementar worker de chunks + dual-write.
5. Backfill idempotente do cache legado e comparar totais por conta/dia/métrica.
6. Trocar a leitura para points/rollups; manter fallback por uma release.
7. Implementar zoom com cancelamento de requests, debounce e orçamento por
   pixels; então remover o blob global quando métricas e latência estiverem
   equivalentes.
8. Paginar CRUD com cursor `(updated_at, id)` ou `(position, created_at, id)` e
   separar DTO de lista de detalhe com comentários/payload completo.

## Reconciliação obrigatória antes do deploy

O ledger remoto não é uma continuação direta do diretório local: há 65 versões
somente locais e 62 somente remotas. Além disso,
`20260916190000_relatorio_entrega_northia.sql` foi ajustada para que um banco
novo não pare por falta de um perfil operacional. Essa correção viabiliza
`db reset`/preview, mas altera a semântica de uma versão que pode já estar
aplicada no remoto.

Por isso, não executar `supabase db push` nem `migration repair` de forma
automática. Primeiro: exportar schema e ledger remoto; comparar cada versão e
provar a equivalência de DDL; classificar `remote-only`, `local-only` e
versões semanticamente equivalentes; e somente então usar `migration repair`
para alinhar o ledger — nunca para marcar como aplicada uma mudança ausente.

Os novos DDLs também endurecem os pontos detectados nessa revisão: o grafo de
tasks é serializado contra ciclos concorrentes e contra troca de cliente de
apenas um nó; o `WITH CHECK` de `task_metrics` confirma a automação no novo
card; rollups verificam que todos os timestamps pertencem ao bucket; e chunks
da mesma conta/fonte não podem se sobrepor, mesmo com workers concorrentes.
Ainda é necessário decidir explicitamente como tratar o vínculo legado entre
clientes diferentes, pois uma migration não pode adivinhar qual ponta deve ser
mantida ou movida.

## Aplicação em produção

Em 2026-09-16, as migrations `20260916232701` e `20260916232706` foram
aplicadas diretamente ao projeto Supabase de produção em transações separadas
e registradas no ledger. O preflight encontrou zero slots duplicados, zero
cache windows inválidos e um vínculo cross-client legado; esse vínculo foi
preservado, pois não há decisão de negócio segura para removê-lo ou movê-lo.

A validação em produção confirmou índices, triggers, constraints, as quatro
tabelas de trace e suas 16 políticas RLS. Um insert de chunk sobreposto foi
recusado dentro de uma transação revertida; nenhum dado de teste persistiu.
Os advisors posteriores não apontaram FKs sem índice ou RLS sem InitPlan.
Permanecem avisos pré-existentes de funções `SECURITY DEFINER`, extensão em
`public`, proteção contra senha vazada e políticas permissivas múltiplas.

## Verificação e critérios

- 3 dias, 30 dias, um mês e período histórico fora dos 90 dias recentes;
- cliente filtrado não dispara outro provider;
- cache quente não chama API externa;
- first/min/max/last e razões preservados entre raw e rollup;
- zoom in retorna raw + pontos; zoom out retorna linha LOD sem pontos;
- gaps não viram zero e não são interpolados silenciosamente;
- p95, bytes transferidos, linhas lidas e chamadas externas registrados por
  janela/conta;
- advisors de performance/segurança reexecutados após DDL.

Validação feita nesta auditoria: leitura completa do schema remoto e checagens
de dados; `git diff --check`, TypeScript e 860 testes passaram. Não foi possível
executar replay local das migrations porque Docker/Postgres não estão instalados
neste ambiente. A validação transacional foi feita diretamente em produção,
pois ela é o único ambiente disponível.
