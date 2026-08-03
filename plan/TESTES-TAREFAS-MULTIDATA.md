# Plano de testes — tarefas com múltiplas datas

## Invariantes

1. Uma data cria uma tarefa comum na tela Tarefas.
2. Duas ou mais datas criam um pai recorrente separado e preservam a tarefa original como primeira execução ligada por `plan_id`.
3. O pai aparece em Clientes/Rotinas e não aparece no quadro Tarefas.
4. Somente a primeira execução aparece imediatamente em Tarefas; uma futura é criada por ciclo e fica oculta até ser aberta pelo pai.
5. Alterar status, título, responsável, comentário ou outro conteúdo replica a mudança nas outras execuções já materializadas.
6. A replicação nunca altera `id`, `plan_id`, `due_date`, `start_date` ou os atributos de recorrência dos filhos.
7. Repetir a criação/sincronização não duplica execuções: o ID é determinístico por pai e data.
8. Plano de Ação continua sem recorrência e filhos comuns de planos não entram na replicação.

## Pirâmide de testes

- Unitários: normalização de datas, inferência semanal/quinzenal/mensal, filtro do patch replicável e materialização sem `deferred_until_accessed`.
- Integração de API: criação com 1, 2 e 3 datas; atualização de filho; preservação das datas; isolamento entre grupos.
- E2E: autenticar, converter uma tarefa existente para duas datas, confirmar que seu `id` continua visível, concluir o primeiro ciclo, abrir a futura pelo pai e confirmar que ela entra em Tarefas.
- Regressão: ciclo semanal existente, progresso/feature flag, Plano de Ação e filtros da tela Tarefas.

## Casos-limite

- datas repetidas, fora de ordem ou inválidas;
- 31 datas (limite) e tentativa de exceder o limite;
- dois updates concorrentes no mesmo grupo;
- remoção de data de um pai já materializado;
- grupo sem cliente;
- comentário no payload preservando a identidade de cada ocorrência;
- falha parcial durante materialização e nova tentativa idempotente.

## Critérios de aceite

- suíte unitária e E2E verdes;
- build e typecheck limpos;
- complexidade ciclomática máxima: `inferDateGroupRule <= 6`, `createExplicitDateTaskGroup <= 6`, `updateTaskGroup <= 10`;
- modal sem overflow horizontal em 1440×1000, 1024×768 e 390×844;
- header ocupa aproximadamente 10% da altura do modal em desktop; o stepper usa apenas as etapas visíveis, não deixa uma linha após a última etapa e se centraliza na coluna entre identidade e ações.

## Medição realizada

Complexidade ciclomática medida pelo AST TypeScript e protegida por `lib/cyclomaticComplexity.test.ts`:

- `inferDateGroupRule`: **6**;
- `createExplicitDateTaskGroup`: **5**;
- `convertTaskToRecurringGroup`: **7**;
- `updateTaskGroup`: **8**;
- `updateExplicitChildGroup`: **6**;
- `updateExplicitParent`: **6**;
- `materializeNextExplicitExecution`: **7**;
- `completeExplicitTaskCycle`: **7**.
