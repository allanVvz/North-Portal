# Arquitetura de Tarefas, Planos e Recorrências

## Fonte única

Tudo que representa trabalho vive em `public.tasks`. Não criar tabelas paralelas para Plano de Ação, recorrência ou execução.

- Tarefa comum: qualquer `kind` sem recorrência.
- Plano de Ação: `kind = 'plano_acao'`; pode ser uma execução comum ou um template recorrente.
- Pai recorrente: qualquer `kind` com `recurrence_cadence` preenchido e `payload.recurrence_group = true`.
- Entrega de fluxo: qualquer card com `payload.flow_parent = true`, de um tipo cujo `behavior` é `entrega`.
- Filho: tarefa independente ligada ao pai por uma linha em `task_links`.

São três eixos de agregação com três significados: `plano_acao` agrega atividades por composição manual, `recurrence_cadence` agrega execuções por tempo, `payload.flow_parent` agrega etapas por sequência. **Plano e entrega compartilham o mesmo mecanismo de vínculo**; só a recorrência continua usando `plan_id`.

### Classificação canônica

- Recorrência nunca é `kind`; é definida por `recurrence_cadence`, `recurrence_weekdays` e `recurrence_day_of_month`.
- `roteiro` é `kind = 'planejamento'` + `subtype = 'roteiro'`.
- `gravacao` é `kind = 'agendamento'` + `subtype = 'gravacao'`.
- Compatibilidade de leitura para valores antigos vive em `canonicalTaskClassification()`, mas o seletor nunca os oferece como tipos primários.

O significado do pai é determinado por seus atributos, nunca inferido do tipo sozinho. Um filho continua sendo uma tarefa completa, com status, responsável, comentários e prazo próprios.

A marca `payload.flow_parent` é explícita de propósito: existem cards `criativo` anteriores aos fluxos que são trabalho comum, e inferir "criativo sem subtipo = entrega" os transformaria em pais de uma hora para outra — sumiriam do quadro e passariam a marcar 0% com as etapas todas faltando.

### Pertencimento é N:N e mora em `task_links`

Um card pode pertencer a **vários** pais: o mesmo roteiro serve várias peças, a mesma diária de gravação serve vários criativos. `task_links(parent_id, child_id, slot, position)` é o mecanismo, o mesmo para Plano de Ação e para entrega. `slot` diz qual etapa o filho ocupa naquele pai (null em membro de plano).

`plan_id` sobreviveu com um significado só: **ocorrência de recorrência**, que é 1:1 por natureza. O antigo `payload.action_plan_id` — workaround que existia porque um card podia ter dois pais — foi removido junto com a migração dos elos (`20260828210000_task_types_e_links.sql`); nenhuma linha o usava.

Excluir um pai nunca exclui os filhos: os elos somem por `on delete cascade` em `task_links`, os cards ficam.

## Fluxos em cascata

Um criativo não é um card: é uma corrente de trabalhos diferentes feitos por pessoas diferentes — Roteiro → Captação → Edição → Publicação. A **entrega** é o pai (`flow_template_id` preenchido) e cada **etapa** é um filho comum ligado por `plan_id`, com `payload.flow_step_key` marcando qual etapa do molde ela é. Os dois marcadores são disjuntos de propósito: só o pai tem a coluna, só a etapa tem a chave no payload.

**O molde é o próprio vocabulário.** `task_types` é auto-referenciada: linha sem pai é um Tipo, linha com pai é um Subtipo. Um fluxo É um tipo (`behavior = 'entrega'`) e suas etapas SÃO os subtipos dele, na ordem de `order_index` — não existe uma segunda lista para manter em sincronia. `behavior` também distingue `plano` e `simples`.

`lib/taskCatalog.ts` continua sendo a fonte do **visual** (tom, ícone) e do **progresso** (workflow, percentuais); a tabela é a fonte do **vocabulário**. Os campos do catálogo são lidos de forma síncrona em dezenas de componentes, e trazê-los para o banco tornaria assíncronos o Kanban, o Calendário, a Performance e o portal.

1. **Uma porta só de criação.** Não existe botão de entrega: o TIPO escolhido decide o que nasce. Um tipo `entrega` cria o pai e a primeira etapa juntos e devolve a etapa — o pai não ocupa coluna no quadro. O subtipo escolhido diz por qual etapa a corrente começa; as anteriores contam como puladas.
2. Concluir uma etapa materializa a próxima. O gatilho é `completed_at` passar de null para não-null, não um status: o trigger `tasks_sync_completed_at` já carimba essa coluna em `('aprovado','concluido')` por qualquer caminho de escrita, inclusive a aprovação feita pelo cliente no portal.
3. Concluir uma etapa avança **todas** as entregas de que ela participa, cada uma no seu slot. O id da etapa nova é determinístico por (entrega, subtipo) — `lib/derivedTaskId.ts`, o mesmo hash da recorrência; e a trava que mais importa é o **slot ocupado**, porque um card pode ter sido ligado à mão ali pelo botão de corrente.
5. O pai nasce em `em_producao` e, quando a última etapa conclui, vai para `revisao` se tiver revisor, `aprovacao` se só tiver aprovador, e `concluido` se não tiver nenhum dos dois.
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
- Etapa de fluxo nunca recebe `payload.flow_parent`; caso contrário geraria uma árvore infinita, mesma razão do filho recorrente não herdar recorrência.
- Cascata é append-only: reabrir uma etapa nunca apaga a seguinte, que já pode carregar comentários, anexos e a decisão de um revisor.
- Ligar um card a uma etapa compartilha, não copia: é um elo a mais, e o card continua contando em todas as entregas de que participa.
- A entrega fica fora do quadro Tarefas (`belongsToTaskScreen`), como o Plano de Ação e o pai recorrente — status derivado não tem coluna honesta. Ela vive em Operação › Entregas.
- O denominador do progresso de uma entrega é congelado em `payload.flow_total_weight` na criação: editar o tipo depois não reescreve o progresso de entregas em andamento.
- O toggle “Visível para o cliente” é fail-closed enquanto a feature flag carrega.
- Funções críticas têm limite automatizado de complexidade ciclomática em `lib/cyclomaticComplexity.test.ts`.

## Checklist para mudanças futuras

1. Alterou relação pai/filho? Validar Plano de Ação, recorrência e fluxo juntos.
2. Alterou feed de Tarefas? Testar que execução futura continua oculta.
3. Alterou abertura de card? Testar ativação e navegação do filho.
4. Alterou responsável? Testar múltiplos nomes e agrupamento por pessoa.
5. Alterou consulta? Confirmar índice existente e medir antes de criar outro.
6. Rodar `npm test`, `npm run typecheck` e `npm run build`.
