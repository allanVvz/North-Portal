# Handoff — Tarefas, Rotinas e Clientes

**Branch:** `feat/clientes-recorrencias`

**Projeto Supabase:** `rqwycltgnnvaunvmyxea`

**Checkpoint:** 2026-07-21 — implementação concluída, validada e pronta para commit/deploy.

## Estado final

- Recorrência é atributo de `tasks`, nunca tipo de card.
- Tipos primários canônicos: Plano de Ação, Criativo, Agendamento, Planejamento, Operacional e Checkpoint Comercial.
- `roteiro` é subtipo de Planejamento; `gravacao` é subtipo de Agendamento.
- As 11 linhas de produção que ainda usavam os tipos antigos foram normalizadas: 3 roteiros e 8 gravações. A verificação final encontrou zero tipos legados.
- Qualquer tipo, exceto Plano de Ação, pode receber recorrência pelo campo inteligente de data.
- “Concluir ciclo” avança para a próxima data, cria uma tarefa independente ligada ao pai e usa ID determinístico + `expectedDueDate` contra repetição.
- Uma rotina semanal com vários dias percorre todos em ordem. O cenário segunda/quarta/sexta foi validado ponta a ponta por três conclusões consecutivas.
- A tela passou a chamar recorrências de **Rotinas**, ganhou resumo operacional recolhível e mantém Colunas, Lista e Calendário na mesma linha estrutural.
- O botão `+ Tarefa` de Rotinas reutiliza forma e posição do botão da tela Tarefas.
- Tarefas e Rotinas compartilham o motor de grade mensal em `app/admin/calendarUtils.ts`.
- O modal é alto, amplo e responsivo; comentários ficam à direita em desktop e abaixo em telas menores.
- O progresso do cabeçalho obedece ao atributo “Progresso” e acompanha o status ainda não salvo. O defeito de porcentagem congelada era causado pela leitura de `liveTask.status` em vez do status do rascunho.
- O toggle “Visível para o cliente” continua fail-closed e só aparece com a feature flag explicitamente ligada.

## Validação executada

- `npm run typecheck`: aprovado.
- `npm test`: 14 arquivos, 116 testes aprovados.
- `npm run build`: aprovado, 30 páginas geradas.
- E2E `recurrence-cycle.spec.ts`: aprovado; datas 20/07 → 22/07 → 24/07 → 27/07, três filhos e 409 para token antigo.
- E2E `task-modal-progress.spec.ts`: aprovado; flag desligada oculta a barra e flag ligada acompanha 0% → 60% → 100%, persistindo `aprovado` no banco.
- Revisão visual em 1440×1000: modal medido em 1408×920, sem rolagem horizontal e com comentários à direita.
- Card real `AURORA - 2° GRAVAÇÃO`: banco validado como rotina mensal; após a normalização, classificação canônica `agendamento / gravacao`.

## Banco e migrations

- `20260722000001_recurrence_on_tasks.sql`: já aplicada anteriormente.
- `20260722000003_canonical_task_kinds.sql`: versiona a normalização de tipos; a mesma DML já foi efetivada em produção pela API autenticada.
- `20260722000002_remove_legacy_trello_recurrence.sql`: o runtime não usa mais os objetos legados, mas a limpeza DDL continua pendente porque o conector Supabase responde `You do not have permission to perform this action`, inclusive em `list_migrations`.

Quando a permissão administrativa for restabelecida, aplicar as migrations pendentes na ordem. A `20260722000003` é segura para reexecução porque os filtros só alcançam tipos legados que já estão zerados.

## Regra operacional de portas

Uma única instância Next pode usar este checkout por vez. Os E2E agora respeitam `E2E_PORT`, permitindo reutilizar a instância ativa sem iniciar silenciosamente outra na porta 3000. Procedimento completo: `docs/OPERACAO-LOCAL-PORTAS.md`.

## Arquivos centrais

- Domínio: `lib/taskCatalog.ts`, `lib/recurrence.ts`, `lib/taskRelations.ts`.
- Backend: `lib/supabase.ts`, `app/api/admin/tasks/**`.
- UI: `app/admin/ClientsWorkspace.tsx`, `app/admin/KanbanBoard.tsx`, `app/admin/TaskModal.tsx`, `app/admin/CalendarPicker.tsx`.
- Testes críticos: `lib/recurrence.test.ts`, `lib/taskCatalog.test.ts`, `app/admin/visibilityRules.test.ts`, `e2e/recurrence-cycle.spec.ts`, `e2e/task-modal-progress.spec.ts`.

## Invariantes que não podem regredir

1. Não criar tipo ou tabela específica para recorrência.
2. Plano de Ação não pode ser recorrente.
3. Filho de rotina não herda recorrência.
4. `expectedDueDate` e ID determinístico são obrigatórios no fechamento do ciclo.
5. Progresso de pai usa as tarefas relacionadas; progresso de tarefa comum usa o status atual do editor.
6. A barra de progresso não renderiza quando o atributo está desligado.
7. A visibilidade para cliente permanece fail-closed.
8. Não rodar `next dev`, E2E e `next build` simultaneamente no mesmo checkout.
