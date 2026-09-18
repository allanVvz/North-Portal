# Arquitetura de tarefas, Entregas e workflows

## Contrato canônico

`public.tasks` continua sendo a única tabela de cards. A classificação
persistida é `tasks.task_type_id`; `kind/subtype` são projeções de leitura para
as superfícies existentes, nunca entrada estrutural para workflows.

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
- Nenhuma chave legada de `payload` carrega estrutura de workflow.
- Não existe `relation_kind = família`. `structural_member`, `workflow_step`,
  `reference` e `dependency` mantêm seus papéis explícitos.

## Estado, prazo e progresso

A Entrega é um rollup mecânico. Seu progresso usa o peso de todos os passos da
versão, inclusive os ainda não materializados. Ela e a primeira etapa nascem
em `Entrada`; só entram em `Em produção` quando essa etapa é iniciada. O estado
é persistido exclusivamente como projeção da etapa aberta e não é editável. O
prazo é o último prazo previsto do workflow; na Automação,
antes de o Feedback existir, usa `prazo do relatório + 2 dias corridos`; depois,
usa o prazo real do Feedback e das etapas seguintes.

Plano, Entrega e Recorrência usam o mesmo resolvedor de pai:

- Plano agrega membros em paralelo; o percentual é a média ponderada do avanço
  de cada membro efetivo. `Parada → Revisão → Aprovação → Em produção → Entrada`
  é a prioridade do estado exibido; só todos concluídos resultam em `Concluído`.
- Entrega é estritamente serial: existe um prefixo concluído e, no máximo, uma
  etapa aberta. Etapa futura não pode ser materializada antes da anterior.
- O molde recorrente espelha somente a ocorrência aberta mais recente. Ciclos
  concluídos são histórico, não progresso do ciclo atual.
- Pai sem item aberto fica em `Entrada` e 0%, salvo rotina explicitamente
  concluída ou parada.

O molde recorrente não é uma ocorrência. Ele pode carregar a versão para que
suas ocorrências a herdem, mas `recurrence_group` impede a criação de etapas no
próprio molde.

## Interface

- Cabeçalhos de parent: `Entrega · Criativo` e `Entrega · Automação`.
- A caixa única é `Etapas (x/y)` e lê somente a versão persistida.
- Passo ausente informa o gatilho que o criará.
- O card-pai não tem status editável; o banco e a interface exibem a mesma
  projeção de seus descendentes.
- Comentários em Feedback registram informação, mas não aprovam o card.

## Corte de produção

As migrations `20260917120000_unify_versioned_delivery_workflows.sql` e
`20260917121000_reconcile_report_automation_cutover.sql` formaram o corte
versionado. A correção complementar
`20260918004358_parent_rollup_projection_and_cascade_integrity.sql` elimina
rollups persistidos manualmente e reconcilia apenas elos futuros inválidos,
preservando os cards-filho como Tarefas independentes.

Sequência obrigatória:

1. registrar snapshot em
   `supabase/preflight/20260918_parent_rollup_projection_summary.sql`;
2. aplicar a migration em uma transação, com rollback automático em erro;
3. executar `supabase/postflight/20260918_parent_rollup_projection_summary.sql`;
4. somente após equivalência comprovada, inserir a versão correspondente no
   ledger remoto;
5. validar o fluxo autenticado em `https://northportal.vercel.app`, sem
   disparar a conversão, e manter o cron `0 11 * * *` (08:00 BRT).

Nunca usar `db push`, `migration repair` ou `db reset` neste projeto.

## Aceite

- nenhuma Entrega real sem primeira etapa;
- nenhuma incompatibilidade versão/passo/subtipo e nenhum passo duplicado;
- alteração de classificação depois da ativação recebe `409`;
- cron repetido não duplica run, card, elo ou PDF;
- Feedback vencido permanece aberto/atrasado;
- aprovar Feedback materializa e executa Conversão;
- aprovar Conversão conclui o parent e cria a próxima ocorrência em `Entrada`;
- nenhum texto da interface chama a Automação de “Relatório” nem usa a
  nomenclatura legada de workflow.
