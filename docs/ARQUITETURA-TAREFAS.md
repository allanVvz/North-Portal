# Arquitetura de Tarefas, Planos e Recorrências

## Fonte única

Tudo que representa trabalho vive em `public.tasks`. Não criar tabelas paralelas para Plano de Ação, recorrência ou execução.

- **Tarefa comum**: qualquer `kind` sem recorrência.
- **Plano de Ação**: `kind = 'plano_acao'` (`behavior = 'plano'`); pode ser uma execução comum ou um template recorrente.
- **Pai recorrente**: qualquer `kind` com `recurrence_cadence` preenchido e `payload.recurrence_group = true`.
- **Entrega de fluxo**: card de um tipo `behavior = 'entrega'` marcado com `payload.flow_parent = true`.
- **Filho**: tarefa independente ligada ao pai por uma linha em `task_links` (ou, só na recorrência, por `plan_id`).

São três eixos de agregação com três significados: `plano_acao` agrega atividades por composição manual, `recurrence_cadence` agrega execuções por tempo, `payload.flow_parent` agrega etapas por sequência. **Plano e entrega compartilham o mesmo mecanismo de vínculo (`task_links`)**; só a recorrência continua usando `plan_id`.

O significado do pai é determinado por seus atributos, nunca inferido do tipo sozinho. Um filho continua sendo uma tarefa completa, com status, responsável, comentários e prazo próprios.

A marca `payload.flow_parent` é explícita de propósito: existem cards `criativo` anteriores aos fluxos que são trabalho comum, e inferir "criativo sem subtipo = entrega" os transformaria em pais de uma hora para outra — sumiriam do quadro e passariam a marcar 0% com as etapas todas faltando.

---

## Estrutura prática aceita pelo banco hoje

Referência canônica — conferida no prod `rqwycltgnnvaunvmyxea`. Quando o código e este quadro divergirem, **o banco é a verdade**; abra um PR corrigindo o quadro.

### `public.tasks` — colunas

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `client_id` | uuid? | FK `clients` on delete **cascade**; null = "Outros" |
| `title` | text | NOT NULL |
| `status` | enum `task_status` | default `backlog` |
| `priority` | enum `task_priority` | default `media` |
| `assignee` | text? | lista separada por vírgula — sempre ler com `parseAssignees()` |
| `assignee_profile_ids` | — | **não é coluna de `tasks`**; mora em `task_assignees` |
| `due_date` / `start_date` / `end_date` | date? | |
| `scheduled_start_at` / `scheduled_end_at` | timestamptz? | data + hora, para o calendário |
| `description` | text? | |
| `client_visible` | bool | default `false`; fail-closed enquanto a flag global carrega |
| `payload` | jsonb | default `{}` — **sem schema no banco** (ver "chaves de `payload`") |
| `position` | int | ordem manual dentro da coluna |
| `kind` | **text** | default **`'operacional'`** (era `'criativo'` até `20260831042902`); sem FK ao vocabulário |
| `subtype` | text? | sem FK ao vocabulário |
| `plan_id` | uuid? | FK `tasks` on delete set null — **só ocorrência de recorrência** (filho → template) |
| `reviewer_id` / `approver_id` / `created_by` | uuid? | FK `profiles` on delete set null |
| `requires_review` / `requires_approval` | bool | default `true`; a API deriva de reviewer/approver presente |
| `recurrence_cadence` | text? | CHECK: null ou `semanal` / `quinzenal` / `mensal` |
| `recurrence_weekdays` | smallint[] | default `{}`; CHECK: subconjunto de {0..6} |
| `recurrence_day_of_month` | smallint? | CHECK: 1..31; obrigatório se cadence `mensal` |
| `progress_weight` | numeric | default 1 |
| `created_at` / `updated_at` / `completed_at` | timestamptz | `completed_at` carimbado por trigger |

### CHECK constraints

- `tasks_recurrence_cadence_check` — cadence null ou ∈ (`semanal`, `quinzenal`, `mensal`)
- `tasks_recurrence_day_of_month_valid` — day_of_month null ou 1..31
- `tasks_recurrence_monthly_day` — cadence ≠ `mensal` **ou** day_of_month não-null
- `tasks_recurrence_weekdays_valid` — weekdays ⊆ {0,1,2,3,4,5,6}
- `tasks_plano_nao_e_entrega` — **não** (`kind = 'plano_acao'` **e** `payload.flow_parent = 'true'`)
- `tasks_status_sem_concluido` — `status ≠ 'concluido'`

### Enums

- `task_status`: `backlog`, `em_producao`, `revisao`, `aprovacao`, `aprovado`, `concluido`, `parada`
  - `concluido` está no enum mas **bloqueado por CHECK** — valor órfão (não dá pra remover label de enum). O terminal de sucesso hoje é `aprovado`.
  - `parada` é onde um card cai quando uma automação falha; é a **primeira** coluna do quadro, aparece só quando há card parado.
- `task_priority`: `baixa`, `media`, `alta`

### Triggers em `tasks`

- `set_updated_at` — BEFORE UPDATE
- `tasks_completed_at` (`tasks_sync_completed_at`) — BEFORE INSERT/UPDATE: carimba/limpa `completed_at` quando `status` entra/sai de terminal (`aprovado`, `concluido`). É esse trigger que faz a cascata de fluxo disparar por qualquer caminho de escrita, inclusive a aprovação do cliente no portal (que passa por `updateTaskGroup`, não pela rota admin).
- `notify_task_reviewer_assigned` — AFTER UPDATE

### Vocabulário — `public.task_types` (auto-referenciada)

Linha sem `parent_id` é um **Tipo**; linha com `parent_id` é um **Subtipo** dele. `behavior` (`entrega` / `plano` / `simples`) é o que distingue o comportamento.

Tipos `creatable` + `active` hoje:

| key | label | behavior |
|---|---|---|
| `operacional` | Tarefa | simples |
| `plano_acao` | Plano | plano |
| `criativo` | Entrega | entrega |
| `checkpoint_comercial` | Checkpoint | simples |

Inativos (`active = false`, guardados, nunca oferecidos): `agendamento`, `planejamento` e todos os subtipos deles. Subtipos **ativos**: só os de `criativo` — `roteiro`, `captacao`, `edicao`, `publicacao` (esse último `client_visible = true`).

`lib/taskCatalog.ts` continua sendo a fonte do **visual** (tom, ícone) e do **progresso** (workflow, percentuais), lidos de forma síncrona em dezenas de componentes; `task_types` é a fonte do **vocabulário** (o que se pode criar e as etapas de cada fluxo).

### `public.task_links`

`(parent_id, child_id, slot?, position)` — pertencimento **N:N**. Um card pode ter vários pais (o mesmo roteiro serve várias peças). `slot` preenchido = **etapa de fluxo** (qual etapa o filho ocupa no pai); `slot` null = **membro de plano**. `on delete cascade` nos dois lados: apagar um pai remove os elos, os cards ficam.

### Classificação canônica de leitura

`canonicalTaskClassification()` em `lib/taskCatalog.ts` normaliza valores antigos que **não existem mais em dado** mas o código guarda por segurança: `planejamento`/`agendamento` → `operacional`; `roteiro`/`gravacao` como `kind` → `operacional` + subtype. O seletor de criação nunca oferece esses.

---

## Como um card nasce

**Uma porta só.** `POST /api/admin/tasks?scope=<task|plan|routine|flow-step>` + o `kind` escolhido. O **`behavior` do tipo** decide o que nasce — não o botão. `NewTaskButton` é idêntico em toda tela; tudo se resolve no dropdown de tipo do `TaskModal`.

| condição | o que a API cria | resposta |
|---|---|---|
| `behavior = 'entrega'` e `scope ≠ flow-step` | `createFlowDelivery` — pai (`payload.flow_parent = true`) + 1ª etapa. Recorrência é **rejeitada** (400). | a **etapa** (o pai não ocupa coluna) |
| `scope = flow-step` | `createTask` só do card da etapa (`kind` da entrega + `subtype`), **solto**, sem pai | o card |
| `scope = plan` | força `kind = 'plano_acao'` | a execução |
| `scope = routine` | exige `recurrence_cadence`; `createTask` do **template** (`payload.recurrence_group = true`) | o template |
| `recurrence_cadence` e `scope ≠ routine` | `createRecurringTaskGroup` — pai template + 1ª execução | a **execução** |
| resto | `createTask` | o card |

`plan_id` no corpo do POST **não é campo do insert**: sai de `fields`, o card nasce, e depois `linkTasks(plan_id, delivery_or_task.id)` cria a linha em `task_links`. Numa entrega, quem entra no plano é a **entrega**, não a primeira etapa.

Recorrência exige, **na API** (não no banco): `start_date` e ≥ 1 dia da semana. `recurrence_day_of_month` é derivado do dia do `start_date` quando cadence é `mensal`, e forçado a null nos outros casos.

**Rotina não é um `kind`.** É a quinta entrada do dropdown (`ROTINA_OPTION` em `TaskModal.tsx`): grava `kind = 'operacional'` + `recurrence_cadence` e manda `scope=routine`. A razão é decisiva: recorrência é a coluna `recurrence_cadence`, ortogonal ao tipo, e é isso que permite uma **Entrega recorrente** — um `kind: "rotina"` tornaria a combinação irrepresentável. Ao trocar de "Rotina" para outro tipo no modal, a recorrência é **limpa** (ela foi ligada implicitamente pela Rotina).

---

## Fluxos em cascata (Entregas)

Um criativo não é um card: é uma corrente de trabalhos diferentes — Roteiro → Captação → Edição → Publicação. A **entrega** é o pai (`payload.flow_parent = true`) e cada **etapa** é um filho comum ligado por `task_links` com `slot = <subtype da etapa>`. Os dois marcadores são disjuntos de propósito: o pai tem `flow_parent`, a etapa tem um elo com `slot`.

**O molde é o próprio vocabulário.** Um fluxo É um tipo (`behavior = 'entrega'`) e suas etapas SÃO os subtipos dele, na ordem de `order_index`. Não existe uma segunda lista.

1. Concluir uma etapa materializa a próxima. Gatilho: `completed_at` passar de null para não-null (via `tasks_sync_completed_at`), não um status.
2. Concluir uma etapa avança **todas** as entregas de que ela participa, cada uma no seu slot. O id da etapa nova é determinístico por `(entrega, subtipo)` — `lib/derivedTaskId.ts` (mesmo hash da recorrência). A trava que mais importa é o **slot ocupado**.
3. O pai nasce em `em_producao` e, quando a última etapa conclui, vai para `revisao` se tiver revisor, `aprovacao` se só tiver aprovador, `concluido`… na prática `aprovado` (`concluido` está bloqueado) se não tiver nenhum.
4. `reconcileFlows()` na cron diária varre etapas concluídas sem sucessor — é essa camada que garante a corretude; o gatilho síncrono só existe para a próxima etapa aparecer na hora.

O progresso da entrega divide pelo peso do **molde**, congelado em `payload.flow_total_weight` na criação — não pelo peso das etapas existentes. Congelar impede que editar o molde reescreva o progresso de entregas em andamento.

**Publicar é um card, não um estágio.** As 24 peças históricas ganharam `subtype = 'publicacao'` no card que já existia (`payload.publicado_em` marca quais). `listPublishedTasks` do Performance filtra `subtype = 'publicacao'` concluído.

---

## Ciclo de recorrência

1. O pai (template) guarda `start_date` como âncora, `due_date` como próxima execução, `end_date` como limite visual, e `payload`: `recurrence_group = true`, `recurrence_cycle`, `recurrence_revision`.
2. "Concluir ciclo" calcula a próxima data e avança o pai com concorrência otimista por `expectedCycle` + `expectedRevision`.
3. A API cria um filho para a próxima data, ligado por **`plan_id`** (→ o template). O id do filho é determinístico por pai + número do ciclo — duplo clique retorna a mesma execução.
4. O filho nasce com `payload.deferred_until_accessed = true`: aparece sob o pai, mas ainda não no quadro Tarefas.
5. Clicar no filho remove a marca, registra `accessed_at`, e a tarefa passa a aparecer normalmente.

Ao **converter** uma tarefa existente em recorrente, a API cria um pai separado e preserva o `id` original como primeira execução visível (`recurrence_cadence = null`, `plan_id` → o pai). Invariante: converter nunca faz o card atual sumir de Tarefas.

Não há grupos por datas explícitas (`explicit_occurrence_dates` foi convertido em `20260804000002`). A agenda usa início, fim, frequência e ≥ 1 dia. Semanal emite todos os dias marcados; quinzenal alterna semanas ancoradas pelo início; mensal escolhe, em ±7 dias da âncora, o dia marcado mais próximo.

Desativar a recorrência mantém `payload.recurrence_group` quando há filhos (preserva histórico, permite reativar o mesmo pai). Sem filhos, o template volta a ser card comum.

---

## Chaves de `payload` em uso

O `payload` é `jsonb` livre (`taskPayloadSchema` é `.passthrough()` / a API valida com `z.record`). Chaves conhecidas:

| chave | onde | significado |
|---|---|---|
| `flow_parent: true` | entrega | marca o pai de corrente |
| `flow_total_weight`, `flow_step_count` | entrega | denominador congelado do progresso |
| `flow_step_key` | etapa | qual etapa do molde (resíduo — hoje o `slot` do elo é a verdade) |
| `recurrence_group: true` | template recorrente | marca o pai |
| `recurrence_cycle`, `recurrence_revision` | template | contador de ciclo + revisão da agenda (concorrência otimista) |
| `recurrence_parent_id` | execução recorrente | id do template (redundante com `plan_id`; usado por `recurrenceParentIdOf`) |
| `deferred_until_accessed: true` | execução futura | some do quadro até o primeiro clique |
| `occurrence_date`, `accessed_at` | execução | data da ocorrência / quando foi aberta |
| `publicado_em` | peça histórica | data em que foi ao ar (antes do card de Publicação) |
| `statusLabel`, `statusTone`, `barTone` | qualquer card | rótulo/cor custom do status no card |
| `formato`, `plataforma`, `hora` | criativo / agendado | atributos do card |

---

## Consultas e desempenho

- `listActionPlans()` busca só pais `plano_acao` e, em segunda consulta em lote, os membros por **`task_links`** (não varre todas as tarefas).
- `listRecurringTasks()` busca pais recorrentes + execuções em lote.
- `GET /api/admin/tasks?parentId=<uuid>` abre relações sem carregar um quadro inteiro.
- Feeds do quadro filtram filhos futuros (`belongsToTaskScreen`); a consulta relacional continua enxergando-os.
- Interface atualiza pai e filho localmente após mutações — `router.refresh()` não é pré-requisito.

Índices obrigatórios: `tasks_plan_id_idx`, `tasks_recurrence_due_idx`, `tasks_client_id_idx`. Antes de criar outro, medir.

---

## Responsáveis

`tasks.assignee text` (lista por vírgula) para o **texto congelado** — mantém comentário/card legível depois de a conta ser apagada, e é o único autor de um card de automação. A atribuição real por pessoa mora em `public.task_assignees(task_id, profile_id)`. Todo agrupamento usa `parseAssignees()`; nunca a string inteira.

---

## Pontos frágeis / a decidir

Cada linha é uma frente própria — nada disso está feito.

| # | O quê | Risco hoje | Recomendação |
|---|---|---|---|
| A | `kind` / `subtype` são `text` livre, **sem FK** a `task_types(key)` | baixo — 0 linhas fora do vocabulário | FK em `kind` é seguro hoje. `subtype` idem se auditado. Mexe na compat de `canonicalTaskClassification`. |
| B | 2 filhos com `plan_id` → um `plano_acao` **não-recorrente** (elos que não migraram pro `task_links` em `bd1cbb0`) | baixo — `planParentIdOf` lê `task_links` primeiro | migração de dados curta: mover os 2 para `task_links(slot = null)`, limpar `plan_id`. |
| C | `concluido` órfão no `task_status` (CHECK bloqueia) | nenhum — só confunde | deixar (não dá pra remover label de enum); documentado acima. |
| D | dias-da-semana da recorrência exigidos **só pela API** | baixo — 0 linhas violam | CHECK `recurrence_cadence IS NULL OR array_length(recurrence_weekdays, 1) >= 1`. |
| E | `requires_review` / `requires_approval` default `true` | baixo — a API deriva de reviewer/approver | default `false` (a presença do revisor é a verdade). |
| F | `payload` sem schema no banco | médio — chave com typo entra calada | catálogo acima é o contrato; considerar validar as chaves conhecidas na API. |
| G | ~15 linhas `active = false` em `task_types` (agendamento/planejamento) | nenhum | deixar (histórico) ou limpar numa faxina de vocabulário. |

---

## Invariantes protegidos

- Plano de Ação aceita recorrência; o template aparece em Rotinas e suas execuções em Planos.
- Filho recorrente não herda recorrência (evita árvore infinita).
- Execução futura não aparece no quadro antes do primeiro acesso.
- Converter uma tarefa em recorrência preserva a tarefa original como primeira execução visível; o pai é sempre registro separado.
- Vincular uma ocorrência a um Plano de Ação não altera seu `plan_id` nem vincula ocorrências futuras.
- Remover uma ligação (`task_links`) torna o filho independente; a linha some por cascade.
- Excluir um pai nunca exclui os filhos.
- Um card não pode ser Plano de Ação e Entrega ao mesmo tempo (CHECK `tasks_plano_nao_e_entrega`).
- Etapa de fluxo nunca recebe `payload.flow_parent` (evita árvore infinita).
- Cascata é append-only: reabrir uma etapa nunca apaga a seguinte.
- Ligar um card a uma etapa **compartilha, não copia** — um elo a mais; o card conta em todas as entregas de que participa.
- A entrega, o Plano de Ação e o pai recorrente ficam **fora do quadro Tarefas** (`belongsToTaskScreen`) — status derivado não tem coluna honesta.
- Progresso de pai é sempre rollup dos filhos; nunca persistido.
- O toggle "Visível para o cliente" é fail-closed enquanto a flag carrega.
- Trocar de "Rotina" para outro tipo no modal limpa a recorrência.
- Funções críticas têm limite automatizado de complexidade ciclomática (`lib/cyclomaticComplexity.test.ts`).

---

## Checklist para mudanças futuras

1. Alterou relação pai/filho? Validar Plano de Ação, recorrência e fluxo juntos.
2. Alterou feed de Tarefas? Testar que execução futura continua oculta.
3. Alterou abertura de card? Testar ativação e navegação do filho.
4. Alterou responsável? Testar múltiplos nomes e agrupamento por pessoa.
5. Alterou o `TaskModal` de criação? Testar Tarefa, Plano, Entrega (fluxo completo e etapa única), Rotina — e a troca entre eles.
6. Alterou consulta? Confirmar índice existente e medir antes de criar outro.
7. Rodar `npm run verify` (typecheck + test + build) e os e2e de tarefas.
