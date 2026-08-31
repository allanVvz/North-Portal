# R0.1 — Unificação total da criação de tarefa

Spec de implementação. Frente definida pelo usuário (ver `plan/ROADMAP.md` R0.1).

## Pedido (verbatim)

> Ao selecionar um fluxo, deve ter um default para criar o fluxo completo, linkado
> ao subtipo. Ao selecionar um dos subtipos cria somente a entrega filha. Tudo no
> mesmo exato molde de criação de tarefa. Todos os botões de criação de tarefa
> devem ser exatamente os mesmos. Não deve existir diferença entre o botão de
> criar tarefa entre as telas; todas as diferenças devem estar incorporadas
> dentro da mesma tela do modal de tarefa.

## Estado atual

**Backend já unificado.** `POST /api/admin/tasks?scope=<task|plan|routine>` +
`kind` (com `behavior` de `task_types`) já decide o que nasce:
`behavior === "entrega"` → `createFlowDelivery` (corrente inteira);
`recurrence_cadence` + `scope !== routine` → `createRecurringTaskGroup`;
`scope === routine` → `createTask` (molde); senão → `createTask`.
`scope` só faz 3 coisas no servidor: `plan` força `kind=plano_acao`; `routine`
exige recorrência e barra entrega; distingue grupo recorrente de molde.

**Frontend fragmentado.** 5 pontos de criação abrem `TaskModal mode="new"` com
props diferentes que mudam o comportamento do modal:

| Launcher | Props | Botão |
|---|---|---|
| `app/admin/home/NewTaskLauncher.tsx` | `scope="task"`, `initialKind="operacional"` | "+ Nova tarefa" |
| `app/admin/KanbanBoard.tsx` (L653, L854, L880) | `scope="task"` (hardcoded L964), `initialStatus`/`initialAssignee` da coluna | "+ Tarefa", "+ Adicionar tarefa" |
| `app/admin/operacao/OperacaoWorkspace.tsx` (L591) | `scope="routine"`, `initialKind="operacional"` | (dentro da aba Rotinas) |
| `app/admin/operacao/ParentCardsBoard.tsx` (L241) | `scope` = `"task"` (Entregas, `initialKind="criativo"`) ou `"plan"` (Planos, `initialKind="plano_acao"`) | "+ Entrega", "+ Plano" |
| `app/admin/automacoes/AutomationSettings.tsx` (L169) | `scope="task"`, `initialKind="operacional"` | (dentro de Automações) |

`CardModalLauncher.tsx` é só edição — não é ponto de criação.

**No `TaskModal`, o que essas props controlam:**
- `creationScope="plan"` → `realTypes` filtrado a `behavior==="plano"` (L442);
  `pickKind` bloqueia não-plano (L647); `save` força `kind=plano_acao` (L1028);
  célula "Plano de Ação" escondida; recorrência escondida.
- `creationScope="routine"` → `effectiveScope`, recorrência obrigatória (L1335),
  célula "Plano de Ação" escondida (L1301).
- `creationScope="task"` → `ROTINA_OPTION` anexado à lista de tipos (L449).
- `initialKind` → `draft.kind` inicial + um selo `tm-newtype-badge` fixo ao lado
  do cliente (L1274), que faz o tipo parecer travado.
- Subtipo de um tipo-entrega: força a 1ª etapa e esconde "sem subtipo" (L1239).

## Alvo

### 1. Um componente de botão só

Criar `app/admin/NewTaskButton.tsx` (promover `NewTaskLauncher`), usado em TODAS
as telas com label "+ Nova tarefa". Props: só `prefill?: { clientSlug?: string;
status?: TaskStatus; assignee?: string }` — contexto opcional, nunca
comportamento. Some `creationScope` e `initialKind` como props externas.

Substituições:
- `NewTaskLauncher` → vira `NewTaskButton`.
- `KanbanBoard`: os 3 gatilhos (`{mode:"new"}`, `{mode:"new", initialStatus}`,
  `{mode:"new", initialAssignee}`) passam a montar `<NewTaskButton prefill={...}>`.
  O `ModalState` `"new"` sai; o modal de criação deixa de morar no board.
- `ParentCardsBoard`: o `creating`/`<TaskModal mode="new">` sai; o `texts.newLabel`
  ("+ Entrega"/"+ Plano") vira `<NewTaskButton>`. As abas continuam existindo —
  só o botão que muda.
- `OperacaoWorkspace` aba Rotinas, `AutomationSettings`: idem.

### 2. Modal absorve todas as diferenças

- **Lista de tipos sempre completa** em `mode="new"`: Tarefa, Plano de Ação,
  Rotina (sintético), Checkpoint (se `creatable`), e cada tipo-entrega.
  `realTypes` deixa de filtrar por `creationScope`. `creationTypes` sempre inclui
  `ROTINA_OPTION`.
- **`creationScope` vira estado interno** derivado da escolha:
  `kind==="plano_acao"` → comporta como plano; `rotinaMode` → rotina;
  tipo-entrega → entrega. O `effectiveScope` que a `save()` manda para
  `?scope=` é calculado do `draft`, não da prop.
- **Remover o selo `tm-newtype-badge` fixo** (L1274) — o tipo é o dropdown, não
  um selo.
- **`pickKind`** perde a guarda `creationScope === "plan"`.
- `initialStatus`/`initialAssignee` continuam como pré-preenchimento (vêm do
  `prefill`), sem travar nada.

### 3. Fluxo completo vs. etapa única  ← **decisão pendente, ver abaixo**

Num tipo-entrega, o dropdown de **subtipo** em `mode="new"` ganha uma opção no
topo: **"Fluxo completo"** (default, `on` quando `draft.subtype === ""`). Abaixo,
cada subtipo.

- **"Fluxo completo"** → `save` manda `?scope=flow` (ou sem subtipo, kind
  entrega) → API chama `createFlowDelivery` (comportamento de hoje).
- **Um subtipo** (ex. "Edição") → `save` manda `?scope=flow-step` + `kind` +
  `subtype` → **API nova**: `createTask` com esse kind+subtype, SEM
  `createFlowDelivery`. Nasce um card-etapa solto.

**Backend:** em `app/api/admin/tasks/route.ts`, hoje `behavior === "entrega"`
chama `createFlowDelivery` incondicionalmente (L125). Novo:
```
const flow = behavior === "entrega" && scope !== "flow-step"
  ? await createFlowDelivery(...)
  : null;
```
e aceitar `"flow-step"` na allow-list de `scope` (L66). Um card-etapa sem pai já
é inofensivo (`92c1911`: `chainDelivery` nulo, `reconcileFlows` acha zero pais).

**Texto de ajuda** (`admin-sub`, L1248) acompanha: "Fluxo completo" → "Nasce em
Roteiro. Cada etapa concluída cria a próxima."; subtipo → "Cria só o card de
Edição. Pode ser vinculado a uma entrega depois."

## Decisões (respondidas pelo usuário, 2026-08-30)

1. **Botões por coluna no quadro** ("+ Adicionar tarefa" sob cada coluna):
   **viram o mesmo `NewTaskButton`, pré-preenchendo** o status/responsável
   daquela coluna via `prefill`. O atalho de coluna continua; só o comportamento
   é o mesmo do botão global.

2. **"Entrega filha"**: ao escolher um subtipo, o card nasce **solto** (sem
   entrega-pai), `scope=flow-step` → `createTask`. Vinculável depois pelo botão
   de corrente 🔗.

## Status: IMPLEMENTADO (2026-08-30)

Backend (`route.ts` aceita `scope=flow-step`), `TaskModal` (scope interno via
`effectiveScope`, lista de tipos completa, "Fluxo completo" no subtipo, selo
`tm-newtype-badge` removido, `prefill` no lugar de `initialStatus/Assignee/Kind`),
`NewTaskButton` novo substituindo os 5 launchers (`NewTaskLauncher` apagado).
`ParentCardsBoard`/`ActionPlansBoard` perderam `scope`/`initialKind`/`clients`/
`assignees`. Spec novo `e2e/task-creation-unificada.spec.ts` (4 casos, verdes).
`npm run verify` verde. `plan-delivery.spec.ts:108` continua falhando por
flakiness pré-existente (timeout de 25s no autosave contra o backend real —
falha igual em `main`), sem relação com esta mudança.

## Ordem de implementação

1. Backend: aceitar `scope=flow-step` + ramo condicional em `route.ts`. Teste
   unitário/e2e de que um subtipo cria card solto e "Fluxo completo" cria a
   corrente.
2. `TaskModal`: `creationScope` interno; lista de tipos completa; opção "Fluxo
   completo" no subtipo; remover selo fixo; `pickKind` sem guarda.
3. `NewTaskButton` novo; migrar os 5 launchers; apagar o estado de criação de
   `KanbanBoard`/`ParentCardsBoard`.
4. e2e: criar a partir de Home, quadro (com prefill de coluna), Entregas, Planos,
   Rotinas — todas pelo mesmo botão, resultado certo em cada caso.
5. `npm run verify`.

## Arquivos

- `app/api/admin/tasks/route.ts` — ramo `flow-step`.
- `lib/validation.ts` — `taskCreateSchema` já cobre; conferir.
- `app/admin/TaskModal.tsx` — o grosso.
- `app/admin/NewTaskButton.tsx` — novo (de `home/NewTaskLauncher.tsx`).
- `app/admin/KanbanBoard.tsx`, `app/admin/operacao/ParentCardsBoard.tsx`,
  `app/admin/operacao/OperacaoWorkspace.tsx`, `app/admin/automacoes/AutomationSettings.tsx`,
  `app/admin/home/*` — migrar para o botão.
- `e2e/` — spec novo `task-creation-unificada.spec.ts`; ajustar
  `plan-delivery.spec.ts`, `flow-chain.spec.ts`, `recurrence-*.spec.ts`.
