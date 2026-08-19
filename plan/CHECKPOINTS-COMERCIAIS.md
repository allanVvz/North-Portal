# Checkpoints Comerciais — tela por-cliente + tipos de card

Status: planejado, não implementado. Investigação de código feita em 2026-08-19.

Relacionado: [[task-model-v2]] (catálogo de kinds, `plan_id`, `recurrence_cadence`),
[[INFORMACOES-TRILHAS]] (onboarding é um checkpoint), [[AUTOMACOES-IA-HARNESS]] (princípio
arquitetural de cards compartilhado).

## Estado atual (verificado no código)

- `commercial_checkpoint_templates` é um catálogo **global e plano**: `title`,
  `description`, `order_index`, `active` (`lib/supabase.ts:1705-1785`,
  `lib/validation.ts:397-403`). Não existe campo de tipo/kind.
- `provisionCheckpointsForClient` cria, para **todo cliente**, tasks com
  `kind: "checkpoint_comercial"` **hardcoded** — não há escolha de tipo por checkpoint.
- A única UI hoje é `app/admin/configuracoes/CheckpointTemplates.tsx`, dentro de
  Configurações: CRUD do molde global (título/descrição/ordem/ativo). **Não existe** tela
  por-cliente para selecionar quais checkpoints valem para aquele cliente especificamente.
- Catálogo real de kinds (`lib/taskCatalog.ts`): `plano_acao | criativo | agendamento |
  planejamento | operacional | checkpoint_comercial`. Não existe tabela `recurring_tasks` —
  "rotina" é hoje `recurrence_cadence`/`recurrence_weekdays`/`recurrence_day_of_month` como
  colunas em `tasks`, aplicável a qualquer kind. `taskProgress()` já trata qualquer task com
  `recurrence_cadence` não-nulo como rollup de plano.
- Progresso por checkpoint já é lido hoje (read-only) por `checkpointsProgress()` em
  `lib/taskCatalog.ts`, consumido em `OnboardingTable.tsx`, `ClientsTable.tsx` e no portal
  do cliente (`e2e/commercial-checkpoints.spec.ts` cobre isso).

## Comportamento pedido

A tela de Checkpoints Comerciais deve permitir **selecionar quais cards são os checkpoints
de cada cliente**, mantendo o padrão já descrito (o molde global de
`CheckpointTemplates.tsx`) e também **criar novos** checkpoints como: **Tarefa**,
**Rotina**, **Plano de Ação**, ou **Plano de Ação com Rotinas**.

### Seleção por cliente

- `active` no template hoje é global — precisa de uma tabela pequena e aditiva de override
  por cliente (`client_id + template_id + active`), no mesmo espírito de
  [[task-model-v2]] (colunas/tabelas aditivas, sem migração destrutiva).
- Tela por-cliente lista todos os templates ativos globalmente, com toggle
  ativo/inativo **escopado a este cliente** — reaproveitando `CheckpointTemplates.tsx`
  como precedente de layout/CRUD, não recomeçando do zero.

### Criar novo checkpoint — tipo do card

Botão **"+ Novo Checkpoint"**, no mesmo padrão visual/posicional do "+ Nova Tarefa"/
"+ Plano" (ver [[CLIENTES-BOTAO-CADASTRO]]), abrindo um modal para escolher o tipo:

1. **Tarefa** — card comum, um único `kind` do catálogo.
2. **Rotina** — mesma tarefa, mas com `recurrence_cadence` preenchido (reaproveitar os
   campos de recorrência já existentes no modal de tarefa — pagamento é o exemplo natural
   de checkpoint comercial recorrente).
3. **Plano de Ação** — card `kind=plano_acao`, com membros vinculados por `plan_id`
   (reaproveitar "+ Vincular atividade existente" do `CardModalLauncher`, já descrito em
   [[task-model-v2]]).
4. **Plano de Ação com Rotinas** — mesmo plano de ação acima, mas um ou mais membros
   carregam `recurrence_cadence` — não precisa de modelo novo, é a combinação dos dois
   itens anteriores.

### Mudança de schema necessária (pequena, aditiva)

- `commercial_checkpoint_templates` ganha uma coluna `kind` (hoje sempre implícito como
  `checkpoint_comercial`) para que `provisionCheckpointsForClient` deixe de fixar um único
  tipo — o `kind` do card provisionado passa a vir do template.
- Tabela de override por cliente (acima).

### Arquitetura — pontos de extensão reservados, não implementados agora

Por pedido explícito: **sempre respeitar a arquitetura de cards existente.** Reservar
(documentar, sem migrar ainda) colunas nullable para ligar um checkpoint a:

- **Estado de contato/lead** — quando o pipeline de leads públicos (`feat/leads-publicos`)
  amadurecer, um checkpoint poderá refletir a mudança de estágio de um lead/contato.
- **Card de automação** — checkpoints que nascem de uma automação configurada (ver
  [[AUTOMACOES-IA-HARNESS]]).
- **Card de criativo** — checkpoints de aprovação de criativo.
- **Card de ads**, com rastreio de origem do dado (qual fonte/plataforma originou o
  checkpoint).

Nenhum desses vínculos é implementado nesta rodada — a tela e o schema devem só deixar
espaço aditivo para eles (colunas nullable, sem FK obrigatória), para não repetir o erro de
modelar um sistema paralelo ao invés de estender `tasks`/`plan_id`.

## Fora de escopo desta rodada

A implementação da UI (tela por-cliente + modal de criação) fica só como spec aqui. Vira
mock/implementação em fast-follow, depois da branch `feat/ui-shell-mocks` (rail, tema,
notificações, comentários, botões, integrações) já em andamento — ver
[[AUTOMACOES-IA-HARNESS]] para a visão geral de sequenciamento.
