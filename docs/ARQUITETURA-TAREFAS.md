# Arquitetura de Tarefas, Planos e Recorrências

## Fonte única

Tudo que representa trabalho vive em `public.tasks`. Não criar tabelas paralelas para Plano de Ação, recorrência ou execução.

- Tarefa comum: qualquer `kind` sem recorrência.
- Plano de Ação: `kind = 'plano_acao'`; é um pai único e não pode ser recorrente.
- Tarefa recorrente: qualquer outro `kind` com `recurrence_cadence` preenchido.
- Filho: tarefa independente cujo `plan_id` aponta para o pai.

### Classificação canônica

- Recorrência nunca é `kind`; é definida por `recurrence_cadence`, `recurrence_weekdays` e `recurrence_day_of_month`.
- `roteiro` é `kind = 'planejamento'` + `subtype = 'roteiro'`.
- `gravacao` é `kind = 'agendamento'` + `subtype = 'gravacao'`.
- Compatibilidade de leitura para valores antigos vive em `canonicalTaskClassification()`, mas o seletor nunca os oferece como tipos primários.

O significado do pai é determinado por seus atributos: `kind = 'plano_acao'` agrega atividades; `recurrence_cadence` agrega execuções. Um filho continua sendo uma tarefa completa, com status, responsável, comentários e prazo próprios.

## Ciclo de recorrência

1. O pai guarda em `due_date` a ocorrência corrente.
2. “Concluir ciclo” calcula a próxima data e avança o pai com concorrência otimista (`expectedDueDate`).
3. A API cria um filho para a próxima data, ligado por `plan_id`.
4. Esse filho nasce com `payload.deferred_until_accessed = true`: aparece imediatamente sob o pai, mas ainda não entra no quadro Tarefas.
5. Clicar no filho remove a marca, registra `accessed_at` e abre a tarefa. A partir daí ela aparece normalmente no quadro.

O ID do filho é determinístico por pai + data futura. Duplo clique ou repetição da requisição não duplica a execução.

## Consultas e desempenho

- `listActionPlans()` busca somente pais `plano_acao` e, em uma segunda consulta em lote, os filhos desses pais. Não varre mais todas as tarefas para montar a tela.
- `listRecurringTasks()` busca os pais recorrentes e suas execuções em lote. O modal recebe os filhos já no primeiro render.
- `GET /api/admin/tasks?parentId=<uuid>` existe para abrir relações diretamente sem carregar um quadro inteiro.
- Feeds do quadro filtram filhos futuros. A consulta relacional continua enxergando esses filhos.
- A interface atualiza pai e filho localmente após mutações; `router.refresh()` não é pré-requisito para mostrar a relação.

Índices já existentes e obrigatórios:

- `tasks_plan_id_idx`, criado em `20260706000008_task_model_v2.sql`, atende a busca de filhos.
- `tasks_recurrence_due_idx`, criado em `20260722000001_recurrence_on_tasks.sql`, atende o feed de recorrências por cadência/data.
- `tasks_client_id_idx`, criado em `20260703000003_tasks.sql`, atende o quadro por cliente.

Não foi criada migration nesta refatoração: os caminhos críticos já estão indexados. Adicionar índices redundantes aumentaria o custo de cada escrita. Antes de um novo índice, medir com `EXPLAIN (ANALYZE, BUFFERS)` no volume real.

## Responsáveis

O campo físico continua `tasks.assignee text` para evitar uma tabela adicional. A aplicação trata o valor como lista normalizada, separada por vírgula. Nomes novos podem ser digitados no modal e entram no catálogo histórico após o primeiro salvamento. Todo agrupamento deve usar `parseAssignees()`; nunca agrupar pela string inteira.

## Invariantes protegidos

- Plano de Ação não aceita recorrência, tanto na interface quanto na API.
- Filho recorrente não herda recorrência; caso contrário geraria uma árvore infinita.
- Execução futura não aparece no quadro antes do primeiro acesso.
- Progresso de pai é sempre rollup dos filhos; não é persistido.
- O toggle “Visível para o cliente” é fail-closed enquanto a feature flag carrega.
- Funções críticas têm limite automatizado de complexidade ciclomática em `lib/cyclomaticComplexity.test.ts`.

## Checklist para mudanças futuras

1. Alterou relação pai/filho? Validar Plano de Ação e recorrência juntos.
2. Alterou feed de Tarefas? Testar que execução futura continua oculta.
3. Alterou abertura de card? Testar ativação e navegação do filho.
4. Alterou responsável? Testar múltiplos nomes e agrupamento por pessoa.
5. Alterou consulta? Confirmar índice existente e medir antes de criar outro.
6. Rodar `npm test`, `npm run typecheck` e `npm run build`.
