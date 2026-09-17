# Arquitetura de tarefas e relações

## Fonte única e decisão de produto

`public.tasks` é a única tabela de cards. Remover uma relação nunca apaga um card: relações apenas organizam e contextualizam trabalho existente.

A Operação deve convergir para uma única visão de trabalho relacionado. O card mais alto é a unidade de atenção e representa, por cálculo, a ação aberta mais importante abaixo dele. A visão plana continua como filtro alternativo, não como representação principal. Esta decisão substitui quatro quadros independentes (Tarefas, Entregas, Rotinas e Planos), sem criar uma tabela ou `relation_kind` chamada “família”.

## Modelo canônico

```text
Árvore estrutural calculada (uma raiz canônica)
└─ card agregador ou executável
   ├─ membro estrutural
   ├─ ocorrência recorrente datada
   └─ etapa materializada de workflow

Referência contextual N:N
└─ card existente pode cumprir papéis em várias famílias,
   sem mudar seu dono estrutural nem pesar duas vezes no progresso.
```

| Conceito | Fonte | Regra |
|---|---|---|
| Card | `tasks` | status, prazo, pessoas, material e histórico próprios |
| Tipo/subtipo | `task_types` | classificação/apresentação; não infere parentesco |
| Pertencimento estrutural | relação exclusiva | define raiz, caminho e rollup |
| Referência de workflow | relação contextual N:N | reutiliza card sem assumir sua propriedade |

Recorrência é relação temporal: molde → ocorrências datadas. Workflow é uma definição versionada aplicada à instância. Automação é processo configurado com runs/artefatos; não é `kind` e não reclassifica seu alvo.

## Estado atual e compatibilidade residual

`task_links` já não mistura significado: todo elo persistido tem
`relation_kind`, e `slot` não é interpretado como parentesco. A compatibilidade
restante é exclusivamente da recorrência e de metadados de automação, descrita
abaixo para ser removida na próxima fase.

- Tipos ativos: `operacional` (Tarefa), `plano_acao` (Plano), `criativo` (Entrega) e `checkpoint_comercial` (Checkpoint), validados por trigger contra `task_types`.
- `task_links(parent_id, child_id, relation_kind, slot, position)` torna a semântica explícita. `slot` é somente o papel ordenado de um `workflow_step`; não infere mais parentesco.
- `tasks.plan_id` e `payload.recurrence_parent_id` ainda duplicam o ponteiro da ocorrência recorrente por compatibilidade de leitura, mas ambos apontam para o mesmo molde existente. Molde não carrega pai temporal.
- `payload.flow_parent`, `automation_flow`, pesos e chaves de recorrência carregam estrutura que o banco não consegue validar por completo.
- `task_type_workflow_steps(delivery_type_id, task_subtype_id, order_index)` define, com FKs, quais subtipos de Tarefa compõem cada Entrega. Não há subtipo filho de Entrega nem fallback para “todos os subtipos”.
- `roteiro`, `captacao`, `edicao`, `publicacao` são subtipos de `operacional` (Tarefa) e ocupam o papel de workflow que o elo declara.
- Um card pode ter vários caminhos de workflow compartilhado; escolher “o primeiro pai” é proibido para breadcrumb, Kanban e progresso.

### Incidente de relatório

O molde semanal de relatório não é Entrega. A migration `20260916190000_relatorio_entrega_northia.sql` classificou alvos de automação como `criativo`, enquanto o runtime correto promove somente a **ocorrência** datada a Entrega.

```text
Molde recorrente: Tarefa
└─ ocorrência datada: Entrega · Relatório
   ├─ Automação: relatório de anúncios
   ├─ Tarefa: feedback
   └─ Automação: relatório de conversão
```

Corrigido em produção por `20260917070000_reconcile_report_templates`: a mudança é idempotente e restrita a moldes recorrentes com configuração ativa; ocorrências `flow_parent`, PDFs e etapas não entram no backfill. As reconciliações `20260917071500` e `20260917073000` também eliminaram ponteiros temporais apagados, execuções com cadência copiada e o único elo cross-client histórico, preservando cards, comentários e documentos.

## Arquitetura de destino

### Relações enxutas com FK

`tasks` continua sendo a fonte dos cards. A evolução não cria três tabelas paralelas
para relações que já têm as mesmas FKs: torna explícita a semântica de
`task_links(parent_id, child_id, relation_kind, slot, position)`.

| `relation_kind` | Cardinalidade alvo | Entra no rollup | Uso |
|---|---:|---:|---|
| `structural_member` | um vínculo de propriedade por card | sim | composição de Plano e agrupamentos |
| `workflow_step` | N:N explícito | sim, em cada Entrega ligada | etapa ordenada; uma Diária pode alimentar várias Entregas pelo mesmo card e slot |
| `reference` | N:N | não | reutilização contextual de um card existente |
| `dependency` | N:N acíclico | não | bloqueio entre cards sem mudar a família |

`structural_member` define a única localização canônica do card na árvore de
Plano. `workflow_step` é uma ligação de execução e pode ser N:N: uma tarefa
compartilhada aparece em cada Entrega que ela move, sem ganhar um segundo Plano
dono. A migração reconcilia somente os múltiplos pais estruturais e protege essa
regra com índice parcial. Todas as relações preservam posição; as FKs removem só
o elo — apagar pai nunca apaga cards.

Recorrência e definição de workflow não serão codificadas em um quinto tipo nem em
um novo “card de automação”. A próxima fase extrai, de forma versionada, a relação
molde → ocorrência e a definição → execução a partir de `plan_id` e `payload`.
Até essa troca, esses campos são compatibilidade de leitura/escrita, não fonte de
verdade nova.

Regras protegidas:

1. Um card tem no máximo um `structural_member`, portanto uma localização
   canônica na árvore de Plano.
2. `workflow_step` pode ser N:N para trabalho compartilhado; cada ligação tem
   slot e posição próprios. `reference` é N:N contextual e não entra no rollup.
3. Uma ocorrência tem exatamente um molde e não participa de outro elo estrutural com ele.
4. Cliente, tipo de pai e papel são validados no write path e em SQL onde comprováveis.
5. Nenhuma leitura deriva relação de `slot`; flags estruturais de `payload`
   continuam somente onde ainda representam automação/recorrência, nunca
   parentesco de `task_links`.

### Tipos, subtipos e workflows

Permanecem quatro tipos estruturais: Tarefa, Entrega, Plano e Checkpoint. Recorrência é atributo de molde; Automação é configuração/runs. Todo card novo recebe subtipo explícito, com `geral` quando não houver especialização.

Subtipo responde “o que é?”. Papel de workflow responde “o que faz nesta relação?”. Uma Diária de gravação pode ser Tarefa de produção e `workflow_step` de captação em várias Entregas sem ser duplicada ou reclassificada. A composição do molde é `task_type_workflow_steps`; a instância é `task_links`. São camadas diferentes e ambas têm FK.

Workflows são pequenos e versionados: definição, passos ordenados, pesos, política de responsáveis e dependências. A instância fixa a versão aplicada; editar a definição não reescreve trabalho em andamento.

### Estado, progresso e prioridade familiar

O status de cada card é próprio. `family_state` e `family_progress` são derivados, não valores manuais persistidos.

- Folha usa seu estado/progresso.
- Entrega soma os passos ponderados da versão materializada.
- Plano agrega filhos estruturais diretos; Entrega conta uma vez pelo seu derivado.
- Molde recorrente não soma histórico; ocorrência atual possui família/progresso.
- Cancelado/ignorado fica auditável e fora do denominador; reabrir recalcula ancestrais.
- Referência compartilhada não altera progresso por si só.

A ação atual usa precedência: bloqueada/parada, atrasada, revisão, produção, entrada, concluída. Prazo é o aberto mais crítico; responsável é o da ação atual.

## Operação e TaskModal

O Kanban único lista famílias. Busca por descendente retorna a raiz; filtros podem revelar itens individuais sem duplicar dados. Card mostra tipo, subtipo, ação atual, prazo crítico e progresso familiar.

O TaskModal terá uma seção sempre visível, **Relações**, substituindo caixas repetidas “Faz parte de”, “Etapas” e “Próxima etapa”:

- breadcrumb da raiz ao card e “você está aqui”;
- pai estrutural, ação atual, bloqueio e próximo desbloqueio;
- referências compartilhadas marcadas como fora do rollup;
- árvore, irmãos e histórico paginado sob demanda.

Descrição, materiais e atividade continuam independentes. Ícones seguem contrato único: tipo principal, badge de subtipo, glifo para raiz/etapa/ocorrência/referência/bloqueio; cor é exclusivamente estado; todo ícone sem texto tem rótulo acessível.

## Migração sem perda e validação

1. Inventariar: zerar tipo/subtipo legado ativo, corrigir somente moldes de relatório comprovadamente errados, detectar pais múltiplos, ciclos e links cross-client.
2. **Concluído em produção:** adicionar `relation_kind`, índices e guardas a `task_links`; migrar todos os escritores e remover o fallback por `slot`.
3. Reconciliar vínculos múltiplos: a ocorrência recorrente é filha temporal do molde (`plan_id` + `recurrence_parent_id`), o plano da ocorrência é o dono estrutural das entregas e uma reunião histórica ligada diretamente à entrega é `reference`.
4. **Concluído em produção:** extrair a composição de workflow para `task_type_workflow_steps`; cada etapa é subtipo de Tarefa e a Entrega só aponta para ela por FK. As linhas-filhas legadas de Entrega e os tipos inativos sem uso foram removidos por `20260917083000_normalize_delivery_workflow_steps`.
5. Extrair recorrência de `plan_id` e flags; enquanto a compatibilidade existir, exigir par temporal sincronizado, molde existente e nenhum molde aninhado. Validar cardinalidade, caminho e progresso antes da troca de leitura.
6. Remover adaptadores legados só após E2E de modal e Kanban. Não apagar catálogo/documento histórico sem confirmar zero referências.

Produção é o único ambiente integrado. Toda migration requer preflight, snapshot de schema/ledger, rollback documentado e SQL versionado. Nunca usar `db push`, `migration repair` ou `db reset` automaticamente.

## Critérios de aceite

- Nenhum card novo/migrado usa tipo legado, `slot` ambíguo ou flag estrutural como fonte.
- Todo card abre com caminho relacional estável; nenhum algoritmo escolhe ancestral por ordem incidental.
- Referência compartilhada não duplica card, contagem ou progresso.
- Concluir, reabrir, reagendar e materializar ocorrência atualizam só a família correta e são idempotentes.
- Modal mostra raiz, caminho, relação, ação, bloqueio e histórico sem N+1.
- E2E cobre Tarefa, Plano, Entrega, referência compartilhada, recorrência, relatório e falha/retry de automação.

## Checklist

1. Relação: testar raiz, ciclo, cliente e rollup.
2. Recorrência: testar molde, atual, próxima e histórico sem materialização massiva.
3. Workflow: testar versão congelada e referência compartilhada.
4. Modal/Kanban: validar Família em desktop/mobile.
5. Antes de produção: typecheck, unitários, E2E e modal autenticado na aplicação implantada. O portão de autenticação é `e2e/auth-login.spec.ts`; os cenários de família usam fixtures próprias e não podem depender de dados reais.
