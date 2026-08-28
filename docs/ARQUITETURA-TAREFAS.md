# Arquitetura de Tarefas, Planos e Recorrências

## Fonte única

Tudo que representa trabalho vive em `public.tasks`. Não criar tabelas paralelas para Plano de Ação, recorrência ou execução.

- Tarefa comum: qualquer `kind` sem recorrência.
- Plano de Ação: `kind = 'plano_acao'`; pode ser uma execução comum ou um template recorrente.
- Pai recorrente: qualquer `kind` com `recurrence_cadence` preenchido e `payload.recurrence_group = true`.
- Entrega de fluxo: qualquer `kind` com `flow_template_id` preenchido.
- Filho: tarefa independente cujo `plan_id` aponta para o pai.

São três eixos de agregação com a mesma mecânica de pai/filho e três significados diferentes: `plano_acao` agrega atividades por composição manual, `recurrence_cadence` agrega execuções por tempo, `flow_template_id` agrega etapas por sequência.

### Classificação canônica

- Recorrência nunca é `kind`; é definida por `recurrence_cadence`, `recurrence_weekdays` e `recurrence_day_of_month`.
- `roteiro` é `kind = 'planejamento'` + `subtype = 'roteiro'`.
- `gravacao` é `kind = 'agendamento'` + `subtype = 'gravacao'`.
- Compatibilidade de leitura para valores antigos vive em `canonicalTaskClassification()`, mas o seletor nunca os oferece como tipos primários.

O significado do pai é determinado por seus atributos: `kind = 'plano_acao'` agrega atividades; `recurrence_cadence` agrega execuções; `flow_template_id` agrega etapas. Um filho continua sendo uma tarefa completa, com status, responsável, comentários e prazo próprios.

### Duas relações em uma ocorrência

`tasks.plan_id` continua sendo a relação estrutural principal. Em uma tarefa comum ele pode apontar para um Plano de Ação; em uma ocorrência recorrente ele sempre aponta para o pai da recorrência. Quando somente essa ocorrência também pertence a um Plano de Ação, a relação secundária fica em `payload.action_plan_id`.

Esse campo JSON é um workaround intencional, sem chave estrangeira e sem migration. Leitores de planos e progresso aceitam `plan_id` ou `payload.action_plan_id`, enquanto leitores da recorrência continuam seguindo o `plan_id` direto. Vincular ou desvincular uma ocorrência nunca altera seu pai, e a próxima ocorrência nasce sem `action_plan_id`.

## Fluxos em cascata

Um criativo não é um card: é uma corrente de trabalhos diferentes feitos por pessoas diferentes — Roteiro → Captação → Edição → Publicação. A **entrega** é o pai (`flow_template_id` preenchido) e cada **etapa** é um filho comum ligado por `plan_id`, com `payload.flow_step_key` marcando qual etapa do molde ela é. Os dois marcadores são disjuntos de propósito: só o pai tem a coluna, só a etapa tem a chave no payload.

O molde vive em `task_flow_templates` / `task_flow_steps` (migration `20260828120000_task_flows.sql`), no mesmo papel que `commercial_checkpoint_templates` cumpre para os checkpoints: molde no banco, trabalho em `tasks`.

1. Criar uma entrega (`POST /api/admin/tasks?scope=flow`) cria o pai e a primeira etapa juntos, e devolve a etapa — o pai não ocupa coluna no quadro.
2. Concluir uma etapa materializa a próxima. O gatilho é `completed_at` passar de null para não-null, não um status: o trigger `tasks_sync_completed_at` já carimba essa coluna em `('aprovado','concluido')` por qualquer caminho de escrita, inclusive a aprovação feita pelo cliente no portal.
3. O id da etapa é determinístico por (entrega, `step_key`) — `lib/derivedTaskId.ts`, o mesmo hash que a recorrência usa. Disparar de novo colide na chave primária e não faz nada.
4. `reconcileFlows()` roda na cron diária e varre etapas concluídas sem sucessor. É essa camada que garante a corretude; o gatilho síncrono em `updateTaskGroup` só existe para a próxima etapa aparecer na hora.

O progresso da entrega divide pelo peso do MOLDE, congelado em `payload.flow_total_weight` na criação, e não pelo peso das etapas existentes — senão uma entrega com só o roteiro pronto marcaria 100%. Congelar também impede que editar o molde reescreva o progresso de entregas em andamento.

## Ciclo de recorrência

1. O pai guarda `start_date` como âncora, `due_date` como próxima execução e `end_date` como limite visual.
2. “Concluir ciclo” calcula a próxima data e avança o pai com concorrência otimista por `expectedCycle` + `expectedRevision`; `expectedDueDate` é apenas compatibilidade temporária.
3. A API cria um filho para a próxima data, ligado por `plan_id`.
4. Esse filho nasce com `payload.deferred_until_accessed = true`: aparece imediatamente sob o pai, mas ainda não entra no quadro Tarefas.
5. Clicar no filho remove a marca, registra `accessed_at` e abre a tarefa. A partir daí ela aparece normalmente no quadro.

O ID do filho é determinístico por pai + número do ciclo. Duplo clique ou repetição da requisição retorna a mesma execução sem avançar novamente. Uma alteração concorrente da agenda responde com `recurrence_schedule_changed` e o pai atualizado.

## Agenda contínua

Não existem novos grupos por datas explícitas. A agenda usa início, fim, frequência e pelo menos um dia da semana. Semanal emite todos os dias marcados; quinzenal usa semanas alternadas ancoradas pelo início; mensal escolhe, em ±7 dias da âncora mensal, o dia marcado mais próximo e prefere o futuro em empate.

Ao converter uma tarefa existente, a API cria um pai separado e preserva o `id` da tarefa original como primeira execução visível. Essa é uma invariante: converter em recorrência nunca pode fazer o card atual sumir de Tarefas. O pai aparece em Clientes/Rotinas; a primeira execução permanece no quadro com `recurrence_cadence = null` e `plan_id` apontando para o pai.

Datas futuras não são materializadas antecipadamente. “Concluir ciclo” cria somente a próxima execução, amplia `end_date` quando necessário e marca o filho com `payload.deferred_until_accessed = true`.

Editar a data de uma execução não altera a regra ou o próximo prazo do pai; somente amplia os limites quando sai do intervalo. Execuções de Plano são cards de Plano independentes e não copiam atividades da execução anterior.

Desativar a recorrência mantém `payload.recurrence_group` quando há filhos, para preservar o histórico e permitir reativação do mesmo pai. Sem filhos, o template volta a ser um card comum.

## Consultas e desempenho

- `listActionPlans()` busca somente pais `plano_acao` e, em uma segunda consulta em lote, membros por `plan_id` ou `payload.action_plan_id`. Não varre mais todas as tarefas para montar a tela.
- `listRecurringTasks()` busca os pais recorrentes e suas execuções em lote. O modal recebe os filhos já no primeiro render.
- `GET /api/admin/tasks?parentId=<uuid>` existe para abrir relações diretamente sem carregar um quadro inteiro.
- Feeds do quadro filtram filhos futuros. A consulta relacional continua enxergando esses filhos.
- A interface atualiza pai e filho localmente após mutações; `router.refresh()` não é pré-requisito para mostrar a relação.

Índices já existentes e obrigatórios:

- `tasks_plan_id_idx`, criado em `20260706000008_task_model_v2.sql`, atende a busca de filhos.
- `tasks_recurrence_due_idx`, criado em `20260722000001_recurrence_on_tasks.sql`, atende o feed de recorrências por cadência/data.
- `tasks_client_id_idx`, criado em `20260703000003_tasks.sql`, atende o quadro por cliente.

A migration `20260804000002_continuous_task_recurrence.sql` converte grupos com `explicit_occurrence_dates`, preserva filhos e recompõe limites e próxima execução. Não cria índice redundante.

## Responsáveis

O campo físico continua `tasks.assignee text` para evitar uma tabela adicional. A aplicação trata o valor como lista normalizada, separada por vírgula. Nomes novos podem ser digitados no modal e entram no catálogo histórico após o primeiro salvamento. Todo agrupamento deve usar `parseAssignees()`; nunca agrupar pela string inteira.

## Invariantes protegidos

- Plano de Ação aceita recorrência; o template aparece em Rotinas e suas execuções aparecem em Planos.
- Filho recorrente não herda recorrência; caso contrário geraria uma árvore infinita.
- Execução futura não aparece no quadro antes do primeiro acesso.
- Converter uma tarefa em recorrência preserva a tarefa original como primeira execução visível; o pai é sempre um registro separado.
- Converter uma tarefa já vinculada a um plano transfere esse vínculo apenas para `payload.action_plan_id` da primeira execução.
- Vincular uma ocorrência a um Plano de Ação não altera seu `plan_id` nem vincula ocorrências futuras.
- Remover uma ligação torna o filho independente e limpa tanto `plan_id` quanto os metadados correspondentes no `payload`.
- Excluir um pai nunca exclui seus filhos: todas as ligações diretas e secundárias são removidas antes da exclusão.
- Um registro legado não-Criativo que já esteja em `Publicado` pode salvar campos não relacionados. A API continua proibindo novas entradas nessa combinação.
- Progresso de pai é sempre rollup dos filhos; não é persistido.
- Etapa de fluxo nunca recebe `flow_template_id`; caso contrário geraria uma árvore infinita, mesma razão do filho recorrente não herdar recorrência.
- Cascata é append-only: reabrir uma etapa nunca apaga a seguinte, que já pode carregar comentários, anexos e a decisão de um revisor.
- Etapa não é vínculo revogável: `detachedTaskRelationPatch` recusa desvincular uma etapa da sua entrega, e `actionPlanIdOf` não lê o `plan_id` dela como membership de plano.
- A entrega fica fora do quadro Tarefas (`belongsToTaskScreen`), como o Plano de Ação e o pai recorrente — status derivado não tem coluna honesta. Ela vive em Operação › Entregas.
- Trocar o fluxo de uma entrega é proibido no PATCH: reescreveria o denominador do progresso e deixaria etapas órfãs.
- O toggle “Visível para o cliente” é fail-closed enquanto a feature flag carrega.
- Funções críticas têm limite automatizado de complexidade ciclomática em `lib/cyclomaticComplexity.test.ts`.

## Checklist para mudanças futuras

1. Alterou relação pai/filho? Validar Plano de Ação, recorrência e fluxo juntos.
2. Alterou feed de Tarefas? Testar que execução futura continua oculta.
3. Alterou abertura de card? Testar ativação e navegação do filho.
4. Alterou responsável? Testar múltiplos nomes e agrupamento por pessoa.
5. Alterou consulta? Confirmar índice existente e medir antes de criar outro.
6. Rodar `npm test`, `npm run typecheck` e `npm run build`.
