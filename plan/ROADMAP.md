# North Portal — Roadmap

Fonte única de trabalho pendente. Atualizado em 2026-09-01 contra `main` /
produção (`northportal.vercel.app`). Os arquivos `plan/*.md` individuais continuam
como spec detalhada de cada item; este arquivo é o índice priorizado.

**Já entregue e EM PRODUÇÃO (não repetir):** fluxos em cascata / Entregas (motor,
UI, 5 tipos, funil único, "Publicado" vira card, entrega recorrente); recorrência
v2 (dia-da-semana opcional, sem data-limite, encerra só no molde `aprovado`/`parada`,
TODA tarefa pode recorrer incl. Entrega); higiene do modelo de tarefas (trigger de
vocabulário `kind`/`subtype`, `requires_review`/`_approval` amarrados à tela Etapas,
`payload` com schema em modo strip) — migração `20260831120000`; Performance
Analytics+Aquisição unificado (Fase A dos templates, hierarquia
campanha/conjunto/criativo parcial, funil redesenhado, 3 templates por desfecho);
Automações v2 (registro por card, status `parada`, PDF); notificações reais no
servidor; cadastro de cliente v2 + Home + "Ver cliente" + Leads; capa automática
de cards + navegador de pastas do Drive (caminho público); bússola única +
favicon; foto de perfil coerente; site público restaurado; calendário + menu
mobile gaveta; **cron real de automações ligado em prod** (R1.1 — segredo
`automations_cron_secret` no Vault, job `automations-run-daily` lê o
`x-cron-secret` de lá, endpoint responde 200; migração `20260901010000`);
**save do conteúdo do portal deixou de apagar seções irmãs** (R1.2 — o editor
monta o patch a partir do objeto salvo; `content.trilhas`/`content.documentos`
aposentados); limpeza de comentários mortos citando `flow_template_id`
(R1.5 — entrega hoje é marcada por `payload.flow_parent`, elos por `task_links`).
Ver `CHANGELOG.md`.

---

## Tier 0 — Frentes definidas pelo usuário

### R0.4 — Relatório de anúncios redesenhado + fluxo de conversão / vendas — ✅ FEITO (mergeado 2026-09-01, `cfd1a34`)

Branch `feat/relatorio-conversao-vendas` mergeada na `main` em 2026-09-01
(`cfd1a34`). Ver `CHANGELOG.md`.

- **Fase 0** — relatório PDF da automação reescrito: KPIs por bloco de objetivo
  (tag manual `config.campaignBlocks`), criativos por campanha com fonte
  #1/#2/#3 (`config.adSourceTags`), funil ao final, sem gráfico diário, gauges
  fora por padrão, uma folha A4. Ingestão de `instagram_profile_visits`
  (schema Meta v6). `lib/reports/reportComponents.tsx` extraído.
- **Fase 1** — tipo-entrega `relatorio_conversao` (2 etapas: tráfego auto +
  agendamentos manual), `lib/ai/` (fetch direto na Messages API, sem SDK),
  Automação 2 `relatorio_vendas` lê o comentário do responsável com IA →
  `task_metrics` + `salesReportPdf`. Migrações `20260901000000/100/200`.
  Validado ponta a ponta contra CRIS CAR CARE em prod.
- **Encosta em**: R4.1/R4.4 (loop de escrita da automação a partir de
  comentários — este fluxo é o primeiro caso concreto), R4.6 (a credencial
  `'ai'` genérica já é lida por serviço; falta a tela de modelos por provedor),
  R6.11 (`coleta_metrica_cliente` segue stub; `relatorio_vendas` resolve o caso
  de agendamentos por outro caminho — flow step, não pendência no portal).
- **Follow-ups**: regerar o relatório de anúncios com atribuição de receita por
  fonte (hoje só no de vendas); trigger em insert de comentário para a
  Automação 2 reagir na hora; `e2e/relatorio-conversao.spec.ts` (Playwright);
  ingestão Meta de `followersGained` (a API não expõe).

### R0.1 — Unificação total do botão e do modal de criação de tarefa — ✅ FEITO (2026-08-30)

Entregue: `NewTaskButton` único em toda tela; `TaskModal` deriva o
`creationScope` do tipo escolhido; `scope=flow-step` cria só o card da etapa;
`NewTaskLauncher` e os 5 pontos de criação fragmentados removidos. Spec
`e2e/task-creation-unificada.spec.ts`. Detalhe em `plan/CRIACAO-TAREFA-UNIFICADA.md`.

<details><summary>spec original</summary>

**Pedido do usuário (2026-08-30), verbatim:**
> Ao selecionar um fluxo, deve ter um default para criar o fluxo completo, linkado
> ao subtipo. Ao selecionar um dos subtipos cria somente a entrega filha. Tudo no
> mesmo exato molde de criação de tarefa. Todos os botões de criação de tarefa
> devem ser exatamente os mesmos. Não deve existir diferença entre o botão de
> criar tarefa entre as telas; todas as diferenças devem estar incorporadas
> dentro da mesma tela do modal de tarefa.

**Estado atual (fragmentação a eliminar):** 6 pontos abrem `TaskModal mode="new"`
com props diferentes, e o modal muda de comportamento conforme elas:

- `app/admin/home/NewTaskLauncher.tsx` — "+ Nova tarefa", `creationScope="task"`, `initialKind="operacional"` (o comentário já diz que devia ser a única porta).
- `app/admin/KanbanBoard.tsx` (~L960) — `creationScope="task"` + `initialStatus`/`initialAssignee` da coluna.
- `app/admin/operacao/OperacaoWorkspace.tsx` — dois: `initialKind="criativo"` (Entregas) e `creationScope="routine"` + `initialKind="operacional"` (Rotinas).
- `app/admin/operacao/ParentCardsBoard.tsx` (~L242) — `creationScope={scope}`, `initialKind`.
- `app/admin/plano/ActionPlansBoard.tsx` (~L32) — `initialKind="plano_acao"`.
- `app/admin/automacoes/AutomationSettings.tsx` (~L169) — `creationScope="task"`.

`TaskModal.tsx`: `TaskCreationScope = "task" | "plan" | "routine"` (L62);
`ROTINA_OPTION` sintético só entra quando `scope === "task"` (L449); `creationTypes`
filtra por `behavior === "plano"` quando `scope === "plan"` (L442); `initialKind`
às vezes trava o dropdown de tipo (L1274).

**Alvo:**

- Um componente de botão de criação só (ex. `NewTaskButton` reusando `NewTaskLauncher`), idêntico em todas as telas. A tela de origem some como fator; no máximo passa um *contexto opcional de pré-preenchimento* (cliente atual, coluna de origem) que o modal aceita mas não depende.
- Dentro do modal, o **seletor de tipo** cobre todos os casos: Tarefa, Plano, Rotina (já sintético), Checkpoint, e cada **tipo de fluxo/Entrega**.
- Ao escolher um **tipo de fluxo** (Entrega): default = **criar o fluxo completo** (card-pai Entrega + toda a corrente de etapas do molde), linkado por subtipo. É o `createFlowDelivery` que já existe (`lib/flows/`).
- Ao escolher um **subtipo específico** (ex. só "Edição"): cria **somente o card-etapa** ("entrega filha"), sem materializar a corrente inteira.
- `creationScope` deixa de ser prop externa — vira estado interno derivado da escolha de tipo. `initialStatus`/`initialAssignee` continuam como pré-preenchimento opcional.

**Specs:** `plan/CLIENTES-BOTAO-CADASTRO.md` (padrão de "botão único"),
`docs/ARQUITETURA-TAREFAS.md`, commit `bd1cbb0` (primeira metade já feita — "uma
porta de criação"). **Memória:** `fluxos-cascata`, `task-model-v2`.

**Tamanho:** médio-grande. **Risco:** médio — mexe no `draftFrom`/`creationTypes`
do `TaskModal` (arquivo grande, muitos ramos por `mode`/`scope`); precisa de e2e
cobrindo criação a partir de cada tela. **Dependência:** nenhuma bloqueante; o
backend de fluxos (`createFlowDelivery`, `GET /api/admin/flow-templates`) já
existe.

</details>

### R0.2 — Trilhas North: vínculo real admin ↔ cliente, lista global — ✅ FEITO (2026-08-31)

Entregue e verificado: tabela `north_trilhas` (global, RLS authenticated-read /
admin-write) **aplicada em prod via MCP** (versão remota `20260831024000`),
`NorthTrilhasManager` (add HTML + YouTube, drag-reorder), rotas
`/api/admin/north-trilhas`, `TrilhaViewer` no portal, `TrilhasPage` lendo
`payload.northTrilhas`, Manual do Cliente virou linha `kind='manual'` semeada.
`content.trilhas` saiu do editor de cliente. `e2e/informacoes-trilhas.spec.ts`
reescrito e **verde contra o backend real** (3 casos: abas navegam, vídeo cai em
`north_trilhas` sem client_id + reorder persiste, portal mostra a mesma lista).
Progresso per-client fica pra fase 2 (R6.7/R6.8).

<details><summary>spec original</summary>

**Pedido do usuário (2026-08-30):**
> O fluxo de Trilhas North deve equivaler dos dois lados. O admin pode adicionar
> uma apresentação de slides HTML e ela estará disponível em Trilhas North numa
> posição da fila para todos os clientes. Quando pedi para reproduzir o Trilhas
> North do lado do cliente (validado) para o lado admin (não validado), foi criado
> um documento nada a ver — esse vínculo não está real, não reproduz do outro
> lado. Trilhas também poderá ser um vídeo anexado do YouTube — não existe
> planejamento para isso. A mesma tela em admin do HTML deverá suportar adicionar
> um link de vídeo. Todo vínculo é adicionado como próximo item da fila, podendo
> ser reordenado de forma simples com drag-and-drop na lista admin. Trilhas são as
> mesmas para todos os clientes.

**Estado atual (os dois lados NÃO conversam):**

- **Admin** (`app/admin/documentos/InformacoesWorkspace.tsx` → `DocumentsTable variant="trilhas"`): só filtra a tabela `documents` por `isHtmlDocument()`. `documents` tem `client_id` NOT NULL → cada "trilha" é **por cliente**. Sem ordem, sem fila, sem tipo vídeo, sem drag-and-drop. Só upload de arquivo HTML.
- **Cliente** (`app/[slug]/PortalPaged.tsx` → `TrilhasPage`): renderiza `props.ctx.content.trilhas.items` — um array escrito à mão nos defaults do Figma (`app/[slug]/portalData.ts:268`), tipado `type: "Slides" | "Vídeo" | "Guia"`, com `ordem/status/etapa/cta/hero`. `content.trilhas` é renderizado mas **não editável** e é destruído no save (ver R1.2). O único item real é "Manual do Cliente", que abre o componente hardcoded `ManualDoCliente`.
- O cliente **nunca lê a tabela `documents`** para trilhas. Zero vínculo. Por isso "não reproduz do outro lado".

**Alvo:**

- **Store global novo** (não `documents`, que é per-client). Ex.: tabela `north_trilhas` (`id`, `kind: 'slides_html' | 'video_youtube'`, `title`, `desc`, `etapa`, `position`, `source` — `storage_path` do HTML ou `youtube_url` —, `created_at`). RLS: leitura para `authenticated` (todo cliente vê a mesma lista), escrita só admin.
- **Uma tela admin** em Informações › Trilhas North: dois botões de adicionar — "Apresentação HTML" (drop-in, reusa `lib/documentFiles.ts` / `DocumentDropZone`) e "Vídeo do YouTube" (campo de URL, valida e extrai o id). Todo item entra como **último `position`**. Lista com **drag-and-drop** para reordenar (reusar o padrão de `965d1bd` — drag das Rotinas — ou o do Kanban), persistindo `position`.
- **`TrilhasPage` do cliente** passa a ler a lista global (`north_trilhas` por `position`), renderizando slides via o preview HTML que já existe (`DocumentPreviewModal`) e vídeo via embed do YouTube. Mesma ordem, mesmo conteúdo que o admin configurou — os dois lados equivalem.
- **Progresso é per-client, sobreposto à lista global.** Generalizar o `client_prefs.manual_seen` (hoje só o Manual) para um registro por `(client_id, trilha_id)` — visto / não visto, ou `%` quando o formato permitir. O card automático por trilha (spec antiga em `plan/INFORMACOES-TRILHAS.md`) fica como fase 2 (R6.7), não bloqueia o vínculo.
- **`content.trilhas` (o array do Figma) é aposentado** como fonte de dados — ou vira só o fallback de seed enquanto a tabela está vazia.

**Specs:** `plan/INFORMACOES-TRILHAS.md` (esta frente **substitui** as seções
"Jornada — box Trilhas" e "documento HTML incorporável" de lá; a parte "Relatórios
/ 3º estado do toggle" continua válida e vira R6.6). **Memória:**
`portal-nav-bussola`, `manual-do-cliente-risk-audit` (o "seen" via `localStorage`).
**e2e:** `e2e/informacoes-trilhas.spec.ts` (hoje valida a tela admin atual — terá
que ser reescrito).

**Tamanho:** médio. **Risco:** baixo-médio — tabela nova + RLS simples; o risco
está em não quebrar o `TrilhasPage` do cliente (que está "validado") durante a
troca de fonte. **Dependência:** casa com R1.2 (parar de depender de
`content.trilhas`).

</details>

### R0.3 — Recorrência v2 + higiene do modelo de tarefas — ✅ FEITO (2026-08-31)

Quatro decisões do usuário sobre recorrência, todas em produção (commits
`29597e6`, `589d803`):

1. **Sem data-limite nem contador de ciclos** — `recurrence_until`/`recurrence_count`
   rejeitados de propósito; `end_date` é só limite visual.
2. **Encerra só quando o MOLDE vai para `aprovado` ou `parada`** — regra única
   `recurrenceStopped(status)` (`lib/recurrenceState.ts`). Encerrada:
   `completeTaskCycleForRequest` → `409 recurrence_ended`, botão "Concluir ciclo"
   some, `listRecurringTasks().active` vira `false`, automação de relatório para.
3. **Toda tarefa pode recorrer, Entrega inclusa** — `createRecurringFlowDelivery`:
   o molde carrega `flow_parent` + `recurrence_group`, cada ciclo materializa uma
   entrega-ocorrência própria com sua 1ª etapa. Rollup lê a ocorrência, nunca o
   molde.
4. **Dia-da-semana opcional** — `recurrenceWeekdays()` cai no dia da `start_date`;
   sem CHECK novo no banco (mais flexível, não menos).

E as frentes A/B/D/E/F dos "pontos frágeis" de `docs/ARQUITETURA-TAREFAS.md`
(commits `5148cb7`, `0971717`, migração `20260831120000` aplicada via
`execute_sql` — `apply_migration` é bloqueado pelo classificador):

- **A** — trigger `tasks_valida_vocabulario` (`kind` ∈ `task_types` de topo;
  `subtype` ∈ filhos do `kind`). Não virou FK: `task_types` só tem
  `UNIQUE (parent_id, key)`.
- **B** — elo legado `plan_id → plano_acao` não-recorrente movido para
  `task_links(slot = null)`.
- **E** — `requires_review`/`requires_approval` default `false` + dados alinhados a
  `Boolean(reviewer_id)`/`Boolean(approver_id)`; os campos Revisor/Aprovador do
  modal são amarrados 1:1 à tela Configurações › Etapas (sem mais override; os
  atributos `reviewer`/`approver` saíram de `ATTR_DEFS`).
- **F** — `taskPayloadSchema` deixa de ser `.passthrough()`: enumera toda chave
  conhecida, modo strip → typo é descartado antes do insert. `lib/taskPayloadSchema.test.ts`
  trava a completude.

**Restam de A–G:** C (`concluido` órfão no enum — deixar), G (`task_types`
inativos — deixar). **Cards de automação** viram frente própria: **R4.10**.

**Memórias:** `recorrencia-regras-v2`, `higiene-modelo-tarefas`.

---

## Tier 1 — Rápidos, alto impacto, baixo risco

| ID | Item | Fonte | Notas |
|---|---|---|---|
| R1.3 | **`LOCKED_IN_PROD = ["acessos","dashboard","time-north"]`** (`app/[slug]/PortalPaged.tsx:107`) — o admin edita 3 seções que não consegue ver em produção. Decidir: destravar ou remover do editor. | `plan/CADASTRO-V2-ADMIN-HOME.md`, `docs/TELAS-PROD-VERCEL.md` | Trivial (1 array) + decisão de produto. |
| R1.4 | **Service account do Google Drive.** Capa de card e navegador de pastas rodam pelo caminho público; 9 de 13 cards não têm miniatura por falta de compartilhamento. Configurar `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` + compartilhar as pastas dos clientes com o e-mail da conta de serviço. | `plan/CARD-COVER-PREVIEW.md`, `plan/CADASTRO-V2-ADMIN-HOME.md` §K1 | Pequeno em código, operacional. |
| R1.6 | **Apagar branches mortos:** `origin/feat/fluxos-cascata` (0 commits à frente, ainda no remote); `feat/documentos-storage` e `feat/relatorio-conversao-vendas` (mergeada em `cfd1a34`) já não existem local — conferir se sobraram no remote. | `roadmap-2026-08-19` (memória) | Trivial. |

---

## Tier 2 — Fluxos / Entregas (backend pronto, backlog pós-produção)

| ID | Item | Fonte | Tamanho / risco |
|---|---|---|---|
| R2.1 | **Fase 3 — Editor de fluxos em Configurações.** Hoje o molde de Entrega só muda por SQL. `GET /api/admin/flow-templates` já existe; falta a UI de CRUD (etapas, pesos, subtipos, `client_visible` por etapa). | `fluxos-cascata` (memória), `docs/ARQUITETURA-TAREFAS.md` | Médio. Baixo risco (backend pronto). |
| R2.2 | **Fase 4 — Um funil idêntico para todos os tipos.** Remover a lógica condicional de colunas por tipo (`publicadoStepHidden`/`progressColumns` em `app/admin/TaskModal.tsx`); "Publicado" já saiu de `TASK_STATUSES`. | `fluxos-cascata` §backlog | Médio. **Risco:** `concluido` órfão no enum Postgres com CHECK `tasks_status_sem_concluido`; `status` aparece em policies de `tasks` E `task_assignees`; `ALTER TYPE` recusa coluna usada em policy. |
| R2.3 | **Fase 5 — Agendamento reverso a partir da data de publicação.** Dada a data de publicação, derivar para trás os prazos de Roteiro/Captação/Edição. | `fluxos-cascata` §backlog | Médio. Casa com R6.5 (calendário composto). |
| R2.4 | **Performance das consultas SQL de fluxos.** `listParentCards` faz só 2 níveis de fetch; Plano aninhado em fluxo exigirá CTE recursivo. | `fluxos-cascata` | Médio. Só urgente se planos-em-fluxo virarem caso real. |
| R2.5 | **Rótulo de card de origem no thread de comentários da família.** O modal de qualquer card de um plano/entrega já mostra os comentários de todos os cards da família mesclados por data (`mergeFamilyComments`, `FamilyComment.taskId` já vem pronto), mas sem dizer de qual card cada comentário veio. Adicionar um marcador discreto clicável por comentário (`· Captação`) e/ou um filtro por card. | esta rodada (`app/admin/TaskModal.tsx`, `lib/comments.ts`) | Pequeno-médio. Puramente de view. |
| R2.6 | **`StrategicView` cega para etapas não-materializadas.** A view Estratégica (Entregas + Plano) mostra uma entrega como plano de N itens — só `activities.length`, sem o "3/4" nem os estágios que ainda não nasceram. Mover o `stepTotal` de `ParentCardsBoard` para um helper compartilhado e ensinar a StrategicView a contar pelo molde. | `fluxos-cascata`; sessão do modal pai/filho | Pequeno-médio. |

---

## Tier 3 — Performance / Analytics (faseado; Fase A já em prod)

| ID | Item | Fonte | Tamanho / risco |
|---|---|---|---|
| R3.1 | **Templates Fase B — hierarquia e seleção.** Nível `adset` real no contrato Meta (`adset_id/adset_name`), coleta/cache por nível, checkbox por linha na tabela + motor central de seleção hierárquica alimentando KPIs/gráficos/CSV. | `plan/PERFORMANCE-TEMPLATES-HIERARQUIA.md` §13, `HANDOFF-PERFORMANCE-2026-08-20.md` | Grande. Risco médio (contrato Meta). |
| R3.2 | **Templates Fase C — configuração de todos os gráficos.** Menu de 3 pontos por card (Configurar/Duplicar/Ocultar/Mover/Restaurar), modal comum, múltiplas séries e dois eixos Y na tendência. | idem | Grande. |
| R3.3 | **Templates Fase D — métricas de perfil.** `profileVisits`, `followers`, `followersGained`, `costPerFollower`, `costPerMessage`, com proveniência explícita; auditoria de disponibilidade real por conta antes de liberar. | idem | Médio. Risco: atribuição de seguidores a campanhas pode não existir na API — mostrar como contexto de conta, nunca atribuído. |
| R3.4 | **Templates Fase E — validação e release.** Unitários do sanitizador/seleção, e2e de CRUD/RLS, e2e real Meta por nível, smoke em prod. | idem | Médio. |
| R3.5 | **Aba "Orgânico".** Botão-irmão de "Anúncios": réplica estrutural com métricas/textos próprios; pago e orgânico nunca somados. Precisa de fonte IG/FB orgânico autorizada + mapeamento cliente→conta. **Regra: não habilitar antes da fonte e dos testes reais.** | `plan/PERFORMANCE-ORGANICO.md`, `plan/PERFORMANCE-CUSTOMIZACAO.md` | Grande. Depende de fonte de dados. |
| R3.6 | **Alcance único agregado** para relatórios executivos: consulta Meta do período sem `time_increment=1` (hoje o alcance diário é somado e rotulado "acumulado"). | `HANDOFF-PERFORMANCE-2026-08-20.md` §débitos | Pequeno-médio. |
| R3.7 | **Débito técnico de verificação** (adiado por instrução do usuário): rodar `npm run build`, `e2e/performance-templates.spec.ts` e `e2e/performance-acquisition.spec.ts` ao vivo (precisa `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` + conta Meta real), smoke pós-deploy. | `performance-informacoes-session-handoff` (memória) | Médio. `420fda2` foi deployado sem e2e ao vivo. |
| R3.8 | Se a config da aba Aquisição precisar virar parte dos templates de Analytics: elevar o estado para `PerformanceScreen`/provider (hoje os filtros da Aquisição são de sessão). | `HANDOFF-PERFORMANCE-2026-08-20.md` | Médio. Condicional. |
| R3.9 | UX de Performance: sliders de paginação no topo (não rodapé); dropdown de cliente com o componente das telas de Operação (verificar se `420fda2` já resolveu); espaçamento de colunas ajustável mas global; colunas de identidade sticky/compactas (parcial via `stickyIdentityColumns`). | `plan/PERFORMANCE-CUSTOMIZACAO.md` | Pequeno cada. |

---

## Tier 4 — Épico: Harness de IA / automações configuráveis

Documento guarda-chuva: `plan/AUTOMACOES-IA-HARNESS.md`. Só a fatia
`AUTOMACOES-RELATORIO-TRAFEGO` (v2) foi entregue. Ordem pedida: shell admin
(feito) → automações configuráveis → agentes.

| ID | Item | Notas |
|---|---|---|
| R4.1 | **Automações configuráveis na tela:** cada automação com modelo/provedor, system prompt, user prompt e contexto editáveis em Configurações; defaults por agência sobrescrevíveis por cliente. | Depende de R4.6. |
| R4.2 | **Contexto versionado:** cada contexto é uma tarefa recorrente cujo card filho, a cada recorrência, vira uma nova versão. | Reusa modelo de recorrência. |
| R4.3 | **Plano de ação versionado por release da automação** (mudança de prompt = nova versão registrada). | |
| R4.4 | **Loop de escrita da automação:** escreve nos campos de texto do card, reprocessa a partir de cada novo comentário, conclui quando aprovado; card mostra "em produção" no indicador de %. | |
| R4.5 | **Agentes planejados:** **Bia — Copywriter** (dispara ao concluir card `criativo`, propõe legenda); **Social media plan** (dispara ao aprovar legenda, sugere data/hora e melhores horários). | Não implementados. |
| R4.6 | **Migration do CHECK de `provider`** para provedores nomeados (Anthropic/ChatGPT/DeepSeek) com lista de modelos por provedor; hoje só existe `'ai'` genérico (`20260819000002_ai_provider_credential.sql`, round-trip via vault já funciona). Tela mock de "modelos disponíveis" vira real. | Pequeno-médio. |
| R4.7 | **Providers alternativos / Open API:** toggle de provedores oficiais, GET em sistemas externos (Google Maps, scraping autorizado), gateway multi-modelo. | Grande. |
| R4.8 | **Google Drive como integração real** (hoje mock no contexto de automação): preview de imagens/vídeos de pasta direto no card. Casa com R1.4. | |
| R4.9 | **Fluxo de trabalho pedido pelo usuário:** desenho com Opus → execução com Sonnet → validação e2e com Opus alimentando fixes de volta para múltiplos agentes Sonnet, em loop. Ainda não montado. | `roadmap-2026-08-19` (memória). |
| R4.10 | **Repensar "automação vira card".** Hoje uma automação de relatório se liga a um card comum (`kind='operacional'`) escolhido à mão como alvo (`automation_configs.target_task_id`); o subtipo `relatorio_trafego` existe mas está `active=false`. Frente: tipo dedicado de card para os alvos de automação (reativar/renomear `relatorio_trafego` ou um `kind` próprio), vínculo 1:1 explícito automação↔card, e criação do card pelo próprio fluxo de automação em vez de o admin ter que criar e apontar. O motor de recorrência **já** foi conciliado (dia-da-semana opcional; para de avançar quando o card-pai está `aprovado`/`parada` — `recurrenceStopped`). | `plan/AUTOMACOES-RELATORIO-TRAFEGO.md`, `docs/ARQUITETURA-TAREFAS.md`, `automacoes-plano-pendente` (memória). Casa com R6.6. Médio. |

---

## Tier 5 — Notificações e papéis

| ID | Item | Fonte | Notas |
|---|---|---|---|
| R5.1 | **Sino / central de notificações no portal do cliente.** `notifyClients` está `false` por default porque não há rota nem componente no lado cliente. | `fluxos-cascata` (memória) | Médio. Greenfield cliente. |
| R5.2 | **Notificações push desktop/mobile** direcionadas por login individual. In-app já existe; push não. | `memory.md` RoadMap §6 | Médio-grande. |
| R5.3 | **Due-soon proativo:** hoje é lazy/on-demand; disparo por prazo próximo exige cron. Infra de cron (pg_cron + Vault) já existe da R1.1 — reusar o padrão do `automations-run-daily`. | `roadmap-2026-08-19` (memória) | Pequeno. |
| R5.4 | **Papel "gestor de tráfego"** como **atributo aditivo** (não 3º valor do enum `level`; todo admin geral também é gestor). Migration + revisão de RLS. | `memory.md` RoadMap §2, `plan/AUTOMACOES-IA-HARNESS.md` | Médio. Risco: RLS. Bloqueia R5.5 e parte de R4. |
| R5.5 | **Alertas ao gestor de tráfego** sobre métricas de anúncios (pontos de atenção acionáveis). | `memory.md` RoadMap §5 | Depende de R5.1/R5.4. |

---

## Tier 6 — Outras frentes de produto

| ID | Item | Fonte | Notas |
|---|---|---|---|
| R6.1 | **Checkpoints comerciais por cliente:** tabela de override (`client_id + template_id + active`; hoje `active` é global); coluna `kind` em `commercial_checkpoint_templates` (parar de fixar `checkpoint_comercial`); modal "+ Novo Checkpoint" com 4 tipos (Tarefa / Rotina / Plano de Ação / Plano com Rotinas). Pontos de extensão documentados, não migrados. | `plan/CHECKPOINTS-COMERCIAIS.md` | Médio. Casa com R0.1 (mesmo modal). |
| R6.2 | **Plano de Ação — portar o filtro composto "correto"** (o da tela de Tarefas: escolhe atributo, depois filtro) para as views Lista e Estratégica; trazer a engrenagem de atributos e o `SortMenu` (`app/admin/SortMenu.tsx`); reposicionar o botão "+ Plano" no padrão das outras telas. | `plan/PLANO-DE-ACAO-VIEW-ESTRATEGICA.md` | Médio. Casa com R0.1. |
| R6.3 | **View Estratégica — Quem/Quando/Porquê como dropdowns** em caixa composta; auto-expande no acordeão quando restam <5 planos; `Porquê` é entrada de templates de plano pré-definidos; `Quando` abre calendário composto de 2 meses com range. | idem | Médio. Depende de R6.5. |
| R6.4 | **Capa de card Fase 2** (imagem colada na descrição/comentário, ou primeiro anexo do bucket `documents` como capa — o anexo é o mais barato) e **Fase 3** (escolher a capa à mão, guardar em `payload.cover`). | `plan/CARD-COVER-PREVIEW.md` | Pequeno-médio. Fase 3 depende da 2. |
| R6.5 | **Extrair o calendário composto** (1 box, 2 meses, range — hoje na tela de Performance) como componente compartilhado, reusando `CalendarPicker.tsx`. Bloqueia R6.3 e casa com R2.3. | `plan/PERFORMANCE-CUSTOMIZACAO.md` | Médio. |
| R6.6 | **Informações — 3º estado "Relatórios"** (consumo dos relatórios das automações, não editáveis). Hoje a tela tem Documentos / Trilhas North / Onboarding. | `plan/INFORMACOES-TRILHAS.md` §Relatórios | Depende de R4. |
| R6.7 | **Trilha fase 2 — card criado automaticamente** por trilha, com o cliente como responsável (recorrente ou `plano_acao`); **Onboarding = um plano de ação por cliente** vindo dos checkpoints. Só depois de R0.2. | `plan/INFORMACOES-TRILHAS.md` | Médio. Depende de R0.2 e R6.1. |
| R6.8 | **Link público de progresso por cliente** nas trilhas (visão externa, sem login). Progresso per-client já vem de R0.2; aqui é só a superfície pública. | `plan/INFORMACOES-TRILHAS.md`, `manual-do-cliente-risk-audit` | Médio. Depende de R0.2. |
| R6.9 | **Tela de tarefas prioritárias / da semana** (3 colunas ou 3 linhas). A Home entregue é mais simples que o previsto. **Gate: passar pelo Figma antes de produção.** | `memory.md` RoadMap §3 | Médio. |
| R6.10 | **Editor visual de "Conteúdo do portal" por seção** com miniatura (hoje só lista os nomes das 8 seções e diz "JSON"). O merge/replace já não perde dado (R1.2); resta o pedaço de menor severidade da R1.2: `contentSchema` ainda é `z.record(z.unknown())` (`lib/validation.ts:86`), só com teto de 200 KB — dar shape por seção antes/junto do editor visual. | `plan/CADASTRO-V2-ADMIN-HOME.md` Entrega 2.2 | Médio. |
| R6.11 | **Card de coleta de conversões** (cliente informa o número pelo portal). **Investigado 2026-09-01: NÃO está completo.** Só a base de dados existe — migração `20260825140611` (coluna `automation_configs.collect_metric_keys` + policies `task_metrics` client-insert/update), a `AutomationKey` `coleta_metrica_cliente` no catálogo/validação, e o flag `requiresMetricKeys`. Falta tudo o que roda: `lib/automations/run.ts` exclui a chave de `RUN_KEYS` (comentário "ainda é só stub"), **não existe** `app/api/client/[slug]/metrics/[taskId]`, e o portal não tem a pendência de digitar o número. É construção, não fechamento. | `plan/CADASTRO-V2-ADMIN-HOME.md` Entrega 5 | Médio (era "investigação"). |
| R6.12 | **Revisar ponta a ponta Aprovação/Revisão bloqueante por cliente.** `e2e/client-approval-flow.spec.ts` rodou verde contra o backend real em 2026-08-31 (parte do que era a R1.7); falta o pente-fino de RLS/estados além do happy path — casa com R7.2. | `HANDOFF-PERFORMANCE-2026-08-20.md` | Médio. |

---

## Tier 7 — Segurança (auditoria de 2026-07-06, só o item 1 re-verificado desde então)

Tratar como "não confirmado — checar contra RLS/código atual". Fonte:
`manual-do-cliente-risk-audit` e `prod-supabase-project` (memórias).

| ID | Item | Severidade |
|---|---|---|
| R7.1 | `SUPABASE_SERVICE_ROLE_KEY` de produção pode ainda ser a chave anon/legacy de 2026-06-24; a policy RLS que compensava não existe mais. Escritas de admin funcionam hoje → provavelmente ok, mas **confirmar**. | Alta se verdadeiro |
| R7.2 | RLS `"tasks client approve own"` — `with check` valida só `client_id`, não `status`: cliente com token pode PATCH além da UI via PostgREST direto. | Média |
| R7.3 | `middleware.ts` decide `/admin` por JWT `app_metadata.role`, enquanto os helpers RLS leem de `profiles` — duas fontes de verdade, `app_metadata` já se provou não confiável. | Média |
| R7.4 | `legal_docs` RLS `"legal read all"` sem filtro de status — conteúdo legal em rascunho é publicamente consultável via REST; o banner "Rascunho" é só UI. | Baixa-média |
| R7.5 | Kanban drag sem optimistic lock (last-write-wins); `updateClientBundle` faz 4 escritas sequenciais não transacionais; `mergeAnswers()` em `lib/validation.ts` é dead code. | Baixa |

---

## Sequenciamento sugerido

1. **Tier 0 (R0.1–R0.4) — CONCLUÍDO.** R0.4 (relatório de anúncios + fluxo de
   conversão/vendas) mergeado na `main` em 2026-09-01 (`cfd1a34`).
2. **Tier 1** — R1.1, R1.2, R1.5 fechados (ver topo); R1.7 investigado e
   dissolvido (specs de aprovação/checkpoints já verdes; a lacuna de
   `metric-collection` é a R6.11, que é construção). Resta o operacional:
   R1.3 (decisão de produto), R1.4 (service account do Drive), R1.6 (branches).
3. **R2.1** (editor de fluxos) — menor risco do Tier 2, backend pronto.
4. **R6.5** (extrair calendário composto) — destrava R6.3 e R2.3.
5. **R5.4** (papel gestor de tráfego) antes de mergulhar no Tier 4.
6. **Tier 4** (harness de IA) como épico próprio, com o fluxo Opus→Sonnet→Opus
   (R4.9) montado primeiro.
7. Performance Tier 3 e produto Tier 6 conforme prioridade de negócio.
8. Tier 7 (segurança) — auditar R7.1 logo; o resto num pente-fino dedicado.

---

## Como manter este arquivo

- Ao concluir um item, mover para a lista "Já entregue" no topo (uma linha) e
  apagar a entrada do tier.
- `plan/*.md` individuais continuam sendo a spec; este arquivo é só o índice.
- Datar cada revisão. Última: 2026-09-01 (R0.4 mergeado; R1.1 cron real ligado em
  prod; R1.2 perda de dado no save resolvida — resta só shape do `contentSchema`,
  movido pra R6.10; R1.5 comentários mortos limpos; R1.7 investigado e dissolvido;
  R6.11 investigado — é stub, vira construção).
