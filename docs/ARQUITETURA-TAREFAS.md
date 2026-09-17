# Arquitetura de tarefas, Entregas e workflows

## Contrato canônico

`public.tasks` continua sendo a única tabela de cards. A classificação
persistida é `tasks.task_type_id`; `kind/subtype` existem apenas como projeção
de compatibilidade durante o corte.

```text
task_types
├─ Tarefa
│  ├─ Roteiro / Captação / Edição / Publicação
│  ├─ Relatório de anúncios
│  ├─ Feedback
│  └─ Relatório de conversão
├─ Entrega
│  ├─ Criativo
│  └─ Automação
├─ Plano
└─ Checkpoint

workflow_versions
└─ workflow_version_steps ──FK──> subtipo executável de Tarefa

tasks (Entrega)
└─ task_links.workflow_step_id ──FK──> passo da versão fixada
```

Criativo e Automação usam o mesmo motor. A versão é imutável para a instância:
editar uma definição publica uma versão nova; uma Entrega em andamento continua
na versão que recebeu ao nascer.

## Invariantes

- Toda Entrega recebe `workflow_version_id` e a primeira etapa na mesma
  transação. Uma ocorrência real nunca pode chegar ao commit vazia.
- `task_links.workflow_step_id` é a autoridade. `slot` e `position` são
  projeções legíveis, validadas pelo passo referenciado.
- O subtipo do filho deve ser o subtipo de Tarefa declarado pelo passo, e o
  passo deve pertencer à versão da Entrega.
- Existe no máximo um elo por `(parent_id, workflow_step_id)`. O mesmo card
  ainda pode ser passo de várias Entregas (`workflow_step` N:N).
- Tipo e versão ficam bloqueados quando qualquer etapa deixa `Entrada`. A UI
  desabilita o controle, a API devolve `409` e o banco impede bypass.
- Conclusão compara os cards ligados com todos os passos declarados na versão;
  a ausência de um passo nunca significa conclusão.
- `payload.flow_parent`, `automation_flow`, `flow_step_count`,
  `flow_total_weight` e `flow_step_key` não carregam estrutura.
- Não existe `relation_kind = família`. `structural_member`, `workflow_step`,
  `reference` e `dependency` mantêm seus papéis explícitos.

## Estado, prazo e progresso

A Entrega é um rollup mecânico. Seu progresso usa o peso de todos os passos da
versão, inclusive os ainda não materializados. O estado reflete a ação aberta
mais importante. O prazo é o último prazo previsto do workflow; na Automação,
antes de o Feedback existir, usa `prazo do relatório + 2 dias corridos`; depois,
usa o prazo real do Feedback e das etapas seguintes.

O molde recorrente não é uma ocorrência. Ele pode carregar a versão para que
suas ocorrências a herdem, mas `recurrence_group` impede a criação de etapas no
próprio molde.

## Interface

- Cabeçalhos de parent: `Entrega · Criativo` e `Entrega · Automação`.
- A caixa única é `Etapas (x/y)` e lê somente a versão persistida.
- Passo ausente informa o gatilho que o criará.
- O card-pai não tem status editável; o status acompanha a etapa corrente.
- Comentários em Feedback registram informação, mas não aprovam o card.

## Corte de produção

As migrations `20260917120000_unify_versioned_delivery_workflows.sql` e
`20260917121000_reconcile_report_automation_cutover.sql` formam uma única
transação no runbook direto. A primeira expande/backfill/contrai o schema; a
segunda aplica somente a allowlist auditada e materializa as cinco ocorrências
de 18/09/2026.

Sequência obrigatória:

1. executar `supabase/preflight/20260917_unified_delivery_workflows.sql` e
   `20260917_report_flow_shape.sql`;
2. pausar o cron e remover pelo Storage API o único objeto allowlisted com
   `node scripts/cleanup-report-cutover-storage.mjs --apply`;
3. executar as duas migrations concatenadas na mesma conexão/transação, com
   rollback em qualquer erro;
4. executar `supabase/postflight/20260917_unified_delivery_workflows.sql`;
5. somente após equivalência comprovada, inserir as duas versões no ledger
   remoto;
6. validar o fluxo autenticado em `https://northportal.vercel.app` e reativar o
   cron `0 11 * * *` (08:00 BRT).

Nunca usar `db push`, `migration repair` ou `db reset` neste projeto.

## Aceite

- nenhuma Entrega real sem primeira etapa;
- nenhuma incompatibilidade versão/passo/subtipo e nenhum passo duplicado;
- alteração de classificação depois da ativação recebe `409`;
- cron repetido não duplica run, card, elo ou PDF;
- Feedback vencido permanece aberto/atrasado;
- aprovar Feedback materializa e executa Conversão;
- aprovar Conversão conclui o parent e cria a próxima ocorrência em `Entrada`;
- nenhum texto da interface chama a Automação de “Relatório” nem mostra
  “fluxo de etapas”.
