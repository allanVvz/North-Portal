# Kanban inteligente: relacionamentos entre card, plano, cascata e rotina

Investigação de arquitetura (Opus, 2026-09-16). **Só investigação — nada
abaixo foi implementado.** Cobre plano/cascata/recorrência/relações a pedido
explícito do usuário, para uma sessão de execução (Sonnet) posterior. Cada
achado abaixo cita arquivo:linha real; nada aqui parte de suposição sobre o
código.

O pedido continha hipóteses (nova tabela de relações, grafo, `parent_id`
novo, refazer o Kanban, virar motor de workflow) — nenhuma se confirmou como
necessária. Ver seção 23.

---

## 1. Resumo executivo

A experiência de Operação funciona bem no caso simples (uma recorrência, uma
execução) e degrada quando recorrência, plano, cascata e cards vinculados
aparecem juntos — não porque o modelo de dados seja insuficiente, mas porque
**a mesma informação visual (uma porcentagem, um stepper, uma caixa "Faz
parte de") significa coisas diferentes dependendo do tipo de card**, sem
nenhum sinal disso na interface. O motor de relações (`task_links`, ids
determinísticos, motor de cascata) já é sólido e já lida com casos que
pareceriam exigir um grafo (um card com múltiplos pais, uma etapa
compartilhada por duas entregas) — comprovado em produção e testado. Os
buracos reais são: (a) três fórmulas de "%" diferentes atrás do mesmo rótulo;
(b) um caso observado ao vivo de cabeçalho e corpo do mesmo card contando
histórias diferentes; (c) navegação "voltar" que existe em algumas telas e
não em outras para o mesmo componente; (d) duas fontes de vocabulário de tipo
que podem divergir; (e) uma regra de "um plano por card" que é convenção, não
garantia do banco. A recomendação (seção 12) é uma evolução aditiva e
pequena — uma camada semântica + dois fechamentos de integridade — não uma
reescrita do modelo de relações.

## 2. Evidências observadas

Investigação feita por 3 agentes em paralelo (schema/migrations completo;
representação frontend das relações; automações/NorthAi/integridade) mais
navegação direta em produção (somente leitura, via browser e
`fetch()` no console) nas telas Kanban, Operação (Entregas/Plano/Rotinas) e
APIs `/api/admin/tasks*`.

Achados usados como evidência direta neste documento:
- `ca49e7b5-ac1b-458e-bcad-d9ad442525e4` ("BAITA - Plano de Agosto"):
  `status: "aprovado"` (cabeçalho mostra os 5 pontos Entrada→Concluído
  acesos) enquanto 2 de 8 membros reais (buscados via
  `fetch('/api/admin/tasks?parentId=...')`) estão em `revisao`/`backlog`; o
  próprio corpo do card mostra "6 concluídas" de 7 visíveis. Cabeçalho e
  corpo do MESMO card, duas contas diferentes.
- `f3e33fb1-...`/`1d6239fd-...` ("REUNIÃO ROTINA - ALLAN" ×2): confirmado via
  `payload.recurrence_parent_id`/`occurrence_date`/`recurrence_cycle` que são
  ocorrências legítimas de uma Rotina mensal, não duplicata — usado para
  confirmar que a UI de busca por título pode enganar (dois cards com o
  MESMO título são um padrão são, não um bug).
- `e0b23dce-3f4f-4d2a-bd30-eaa377dbba80` ("Evento Baita 19/09"): screenshot do
  cabeçalho de uma Entrega com stepper de 4 etapas — usado para comparar o
  stepper de Entrega com o de Plano/Rotina (mesmo componente, semânticas
  diferentes, seção 5).

## 3. Modelo atual real

Uma única tabela polimórfica, `tasks`, representa Tarefa/Plano/Entrega/
Checkpoint/Rotina-molde/Rotina-execução, diferenciadas por `kind`/`subtype`
(texto livre, validado contra `task_types` por trigger desde
`20260831120000`), `payload` (JSON, `taskPayloadSchema` em modo strip) e as
colunas estruturais `recurrence_cadence` e `plan_id`.

- **`task_types`** (auto-referenciada): linha sem pai = Tipo (`behavior` ∈
  `entrega|plano|simples`, `creatable`, `active`, `icon`, `tone`); linha
  filha = Subtipo (`lead_days`, `progress_weight`, `default_assignee`,
  `client_visible`). Comanda quais subtipos uma Entrega materializa em
  sequência.
- **`task_links(parent_id, child_id, slot, position)`** — PK
  `(parent_id, child_id)`, `check (parent_id <> child_id)`, ambas FKs
  `ON DELETE CASCADE` **só no elo**, nunca no card
  (`20260828210000_task_types_e_links.sql:140-152`). `slot IS NULL` = membro
  de Plano; `slot = <chave do subtipo>` = etapa de fluxo (cópia
  desnormalizada do subtipo do próprio filho).
- **`plan_id`** — nome legado; hoje seu único uso ativo é
  ocorrência-de-recorrência → molde de recorrência (NÃO membresia de plano,
  que migrou inteira para `task_links` em `20260831120000_higiene_modelo_
  tarefas.sql`).
- **`task_assignees(task_id, profile_id)`** — camada aditiva de conta
  vinculada sobre o campo legado de texto livre `assignee`;
  `mergeAssigneeDisplay`/`freeTextNames` (`lib/assignees.ts`) fundem os dois
  para exibição (alvo do bug de duplicação de responsável corrigido nesta
  mesma sessão, `e6f5582`).
- **Identidade determinística** (`lib/derivedTaskId.ts`, `lib/flows/ids.ts`,
  `lib/recurrence.ts:101-103`): o id de uma etapa/execução é um hash de
  `parentId + chave estável`, nunca de campos editáveis. Combinado com
  tratar `23505` (violação de unicidade) como sucesso, é o mecanismo real de
  idempotência de toda a cascata/recorrência — nascido, segundo o próprio
  código, de um incidente real ("clique duplo criava dois ciclos").
- **Motor de cascata** (`lib/flows/advance.ts` e vizinhos): dispara em
  `completed_at` nulo→preenchido via um único ponto de entrada
  (`updateTaskGroup`, compartilhado por PATCH do admin e aprovação no portal
  do cliente), encontra **todos** os `task_links` pais da etapa concluída
  (não só um) e, para cada um, materializa o próximo subtipo declarado
  (`advanceOneDelivery`) ou, para fluxos "dinâmicos" sem subtipos declarados,
  confere se todas as etapas ligadas estão concluídas
  (`settleTypelessFlow`). `reconcileFlows` (cron diário) é uma rede de
  segurança explícita, não o mecanismo principal de correção.
- **Progresso** — um único ponto de entrada, `taskProgress`→`rollupProgress`
  (`lib/taskCatalog.ts`), serve Plano/Entrega/Rotina-molde, mas ramifica por
  dentro: membros de Entrega (`flow_parent=true`) usam `flowMemberPct`→
  `flowStepPct` (funil de 3/4/5 "casas" dependendo de
  `requires_review`/`requires_approval` daquela etapa específica, contra um
  denominador `payload.flow_total_weight` **congelado na criação** — etapas
  ainda não materializadas contam contra o total); membros de Plano e
  Rotina-molde usam `statusPct` simples (backlog 0/em_produção 35/revisão 60/
  aprovação 80/aprovado 100) ponderado por `progress_weight`, somado só sobre
  membros **atualmente ligados** (sem congelamento).
- **`isRollupParent(task)`** = `kindDef(kind).isPlan || recurrence_cadence ||
  payload.flow_parent === true` — o predicado único para "o status/progresso
  deste card no quadro é derivado, não próprio".
- Um card pode, hoje, ser simultaneamente execução de recorrência + entrega
  em cascata + membro de um Plano diferente — comprovado por
  `createRecurringFlowDelivery` (`lib/supabase.ts:1842-1890`) e pelo e2e
  `recurrence-action-plan.spec.ts`. A única exclusão garantida pelo banco é
  Plano+Entrega no MESMO card (`tasks_plano_nao_e_entrega`,
  `20260829180000`).
- **DAG, não árvore, já suportado**: a "diária de gravação"
  (`lib/flows/shootDayRows.ts`) liga um roteiro e uma captação a N entregas
  diferentes via `task_links` (mesmo `child_id`, N `parent_id`s);
  `advanceFlow` já itera todos os pais de uma etapa concluída — testado em
  `lib/flows/advance.test.ts`.

## 4. Problemas de domínio

- **Duas fontes de vocabulário podem divergir** (achado central): `task_types`
  (banco, comanda a cascata) e `lib/taskCatalog.ts` (catálogo no código,
  comanda ícone/cor/`isPlan`/régua de progresso) deveriam concordar, mas cada
  um muda por um caminho diferente (migração vs. deploy de código).
  Confirmado divergindo agora: `relatorio_conversao` ainda está no union do
  código com a linha em `task_types` desativada
  (`20260902000000_desativa_relatorio_conversao.sql`). Concretamente: um tipo
  NOVO criado em Configurações com `behavior: 'plano'` não é reconhecido como
  Plano pelo quadro/progresso/combobox — só os 5 kinds embutidos são.
- **"Um plano por card" é convenção, não garantia.** `setTaskPlanLink`
  (`lib/supabase.ts:1654-1663`) desliga qualquer outro pai sem slot antes de
  ligar um novo, mas `lib/flows/shootDay.ts:44-47` e
  `lib/tasks/createFromInput.ts:137` chamam `linkTasks` direto, sem essa
  exclusividade. Nada no schema impede hoje um card em 2+ Planos. Sem
  incidente relatado — risco latente, não fogo ativo.
- **Percentual não é uma unidade só** — ver seção 5, é o achado com maior
  impacto de compreensão.
- `flow_prev_task_id` está marcado "resíduo" no próprio schema, sem uso
  visual encontrado — peso morto, não urgente.

## 5. Problemas de UX

- **A mesma "%" significa três contas diferentes** sem nenhum sinal visual:
  Plano/Rotina usam a régua de posição de coluna (`STATUS_PCT`); Entrega usa
  o funil de "casas" com denominador congelado na criação. As duas passam
  pela mesma função (`taskProgress`) e pintam a mesma barra (`.plan-acc-
  fill`) — "70%" não é a mesma coisa nos dois casos, e nada na tela avisa.
- **Cabeçalho vs. corpo contraditórios** — caso real (seção 2): o `status` de
  um Plano é um campo próprio, setável independentemente da conclusão dos
  membros, mas o cabeçalho do card usa um stepper de 5 pontos idêntico ao de
  uma Entrega (que SEMPRE reflete progresso real). Um usuário lendo o
  cabeçalho de um Plano "concluído" não tem como saber que 2 de 8 atividades
  ainda estão abertas sem rolar até o corpo.
- Etapa mirrorada por cascata (`flow_prev_task_id`) e etapa ligada
  manualmente (`task_links.slot`) são visualmente indistinguíveis no card —
  nenhuma indicação de "isto foi automático" vs. "isto foi escolhido".

## 6. Problemas de navegação

- **"Faz parte de" tem volta em algumas telas e não em outras.** Abrir um
  card relacionado a partir de Revisões/Aprovações/Entregas/Plano/Rotinas
  passa por `CardModalLauncher.tsx` (mantém uma pilha local `history`, mostra
  seta de voltar). Abrir o mesmo tipo de relação a partir do quadro
  principal (`KanbanBoard.tsx:1101`, `onOpenRelatedTask`) troca o card via
  `setModalState` sem pilha — não existe `onBack` ali. Mesmo componente
  (`CardParentBox`), mesmo clique, consequência diferente conforme a
  origem — o usuário perde o caminho de volta dependendo de onde clicou.
- `ParentCardsBoard`'s linhas de etapa inline (somente leitura) e `StepRow`
  do `TaskModal` (editável) são visualmente parecidas mas funcionalmente
  diferentes — não é um bug, mas nada sinaliza "isto aqui é editável, aquilo
  não é".

## 7. Limitações do plano

- `PlanAddCombobox` não permite ligar um Plano existente como membro de
  outro Plano — tanto a lista de "tipos criáveis" quanto a de "vincular
  existente" excluem explicitamente `kindDef(t.kind).isPlan`. Não há
  evidência de necessidade real disso (Plano-de-Plano não aparece em nenhum
  fluxo observado) — tratado como limite aceito, não bug (ver seção 22).
- `listParentCards` busca só 2 níveis de filhos (Plano→Entrega→Etapas rola;
  Plano→Plano→Entrega não) — já é o item **R2.4** do roadmap; como Plano
  dentro de Plano não existe hoje, o teto de 2 níveis não é uma limitação
  ativa.
- O `status` do Plano (campo próprio, setável manualmente) e a conclusão dos
  seus membros podem divergir sem aviso — mesmo achado da seção 5, mas
  aqui como limite estrutural: não há hoje nenhum mecanismo que sincronize
  ou pelo menos avise da divergência.

## 8. Limitações das cascatas

- O funil de "casas" da Entrega usa um denominador (`flow_total_weight`)
  congelado na criação — etapas ainda não materializadas contam contra o
  total. Isso é uma decisão deliberada e correta para o propósito da régua
  (dar sentido de "posição no funil todo", não "% das etapas já criadas"),
  mas colide com a leitura de "70%" que qualquer usuário traria de uma barra
  de progresso comum — é o mesmo achado da seção 5, aqui do ponto de vista
  do mecanismo, não da tela.
- A engine já generaliza bem além do exemplo canônico Roteiro→Captação→
  Edição→Publicação: qualquer sequência de subtipos declarados em
  `task_types` funciona, e o padrão DAG (`shootDayRows.ts`) já cobre "uma
  etapa alimenta várias entregas". Nenhuma limitação estrutural encontrada
  aqui — a arquitetura de cascata está sólida.
- `automation_configs.target_task_id` (FK sem checagem de tipo,
  `ON DELETE CASCADE` sem rastro) é um ponto fraco de integridade adjacente
  às cascatas, mas é o item **R4.10**, já tratado à parte (fora de escopo,
  seção 22).

## 9. Limitações das recorrências

- `plan_id` reaproveitado só para ligação ocorrência→molde é uma decisão
  deliberada, documentada e funcional — nenhum problema encontrado aqui além
  do nome do campo ser historicamente confuso (não vale a pena renomear uma
  coluna estrutural só por isso).
- Um molde de recorrência nunca materializa etapas próprias (só a ocorrência
  materializa) — confirmado consistente em todo o código, sem exceção
  encontrada.
- Não existe, nem foi encontrada necessidade de, um conceito intermediário de
  "ciclo" — o usuário pediu explicitamente para não introduzir isso só por
  ter sido sugerido antes, e a investigação não achou nenhum caso onde
  `recurrence_cycle`/`occurrence_date` (já existentes em `payload`) seriam
  insuficientes.
- Uma ocorrência recorrente PODE, hoje, ser simultaneamente entrega de fluxo
  E membro de um Plano — comprovado (`createRecurringFlowDelivery`,
  `recurrence-action-plan.spec.ts`). Funciona; só não é óbvio pela interface
  que essa combinação é suportada.

## 10. Modelo atual de relacionamentos

Três relações distintas compartilham os MESMOS mecanismos de armazenamento:

1. **Composição** ("contém"): Plano → atividades, via `task_links` com
   `slot = null`. Cardinalidade: o banco permite N:N (nada impede um filho
   ligado a 2+ pais sem slot); a aplicação impõe 1-plano-por-card só por
   convenção em `setTaskPlanLink` — ver achado da seção 4, bypassável por 2
   outros caminhos de código.
2. **Sequência/cascata** ("é etapa de"): Entrega(pai) → etapas(filhos), via
   `task_links` com `slot = chave do subtipo`. Cardinalidade: o banco
   permite (e a aplicação usa deliberadamente, testado) um filho com
   múltiplos pais — a "diária de gravação". Identidade determinística é o
   que torna isso seguro.
3. **Recorrência/tempo** ("é execução de"): Molde → ocorrências, via
   `tasks.plan_id` (reaproveitado) + `payload.recurrence_parent_id`
   (redundante, mantido por conveniência de leitura) — NÃO via `task_links`.
   Identidade também determinística (hash de moldeId+ciclo).

Existe uma 4ª relação, hoje majoritariamente morta: grupos de data explícita
(`lib/taskDateGrouping.ts`), superados pela recorrência contínua em
2026-08-04, mas o leitor e um branch inteiro do roteador de PATCH continuam
vivos e alcançáveis, mesmo sem caminho de criação na UI — confunde quem lê o
código (inclusive um futuro NorthAi), sem impacto funcional hoje.

**Um único `parent_id` não bastaria** — as três relações têm regras de
cardinalidade e de ciclo de vida diferentes (composição é 1 pai por
convenção; cascata é DAG deliberado; recorrência é uma cadeia linear
separada). Isso já está corretamente modelado como três mecanismos
paralelos, não uma duplicação acidental — a investigação não encontrou
evidência de que fundir os três em uma tabela genérica resolveria algum
problema real (ver seção 11, Alternativa B).

## 11. Alternativas consideradas

**A — Só cosmético.** Mexer em ícones/rótulos sem tocar nas contas de
progresso. Baixo risco, baixo valor — não resolve os achados mais concretos
(percentuais divergentes, cabeçalho×corpo contraditório).

**B — Tabela de relações genérica / grafo.**
`task_relations(from_id, to_id, relation_type, meta jsonb)` substituindo
`task_links` + payload markers + `plan_id`. Alto risco (toca toda escrita e
leitura do domínio, dezenas de testes, features do NorthAi criadas há
poucos dias), alta migração, sem nenhuma evidência de que resolveria algo
que o modelo atual não resolve — a própria "diária de gravação" já prova
que o modelo atual tolera DAG sem código especial. Rejeitada: sofisticação
desproporcional à evidência.

**C — Camada semântica + fechamentos pontuais (RECOMENDADA).** Não muda o
armazenamento das relações. Acrescenta uma função pura pequena que nomeia a
relação (contém | é etapa de | é execução de | compartilha etapa com) a
partir dos sinais que já existem, e usa isso para consertar exatamente os
achados de percentual, cabeçalho×corpo e navegação. Fecha a lacuna de "um
plano por card" com um índice único parcial. Não mexe no que já funciona.

**D (conservadora) — Só os fechamentos pontuais, sem a camada semântica.**
Resolve os achados de percentual/cabeçalho/navegação/índice imediatamente,
mas cada tela continua decidindo "que tipo de relação é essa" com sua
própria combinação ad hoc de `isFlowDelivery`/`kindDef().isPlan`/
`recurrence_cadence` — que a auditoria já achou começando a divergir
sutilmente (achado da seção 4). Boa se o tempo de execução for curto; não
prepara terreno para o NorthAi perguntar "o que depende disto" de forma
genérica no futuro.

| | Risco | Migração | Resolve os achados centrais | Prepara NorthAi |
|---|---|---|---|---|
| A | Baixo | Nenhuma | Não | Não |
| B | Alto | Grande | Não mais que C | Sim, mas sem necessidade demonstrada |
| **C** | Baixo | Pequena (1 índice) | Sim | Sim |
| D | Baixo | Pequena (1 índice) | Sim (parcial) | Não |

## 12. Recomendação

**Alternativa C.** Justificativa: todo achado concreto desta investigação
(percentual ambíguo, cabeçalho×corpo contraditório observado ao vivo,
navegação inconsistente, vocabulário duplicado, exclusividade de plano não
garantida) é resolvido por uma mudança aditiva que não toca no armazenamento
das relações — porque o armazenamento das relações já está correto e
testado. Rejeitar a Alternativa B (grafo genérico) é uma decisão consciente:
nada na investigação sugere que o modelo atual esteja bloqueando alguma
capacidade real, e reescrevê-lo custaria dezenas de arquivos e testes por um
ganho não demonstrado.

**O que desaparece**: nada é removido do modelo de dados. Only o
código-morto de baixo risco (grupos de data explícita) pode opcionalmente
ganhar um aviso de "não usar" sem ser apagado.

**O que fica**: `task_links` (schema e PK), o hash determinístico de id, o
motor de cascata completo, `plan_id` reservado para recorrência, o funil de
"casas" da Entrega (a régua em si está correta — o problema é ela ser
confundida com a de Plano/Rotina, não que esteja errada), a regra de que um
Plano nunca é uma Entrega, o teto de 2 níveis de `listParentCards`.

**O que muda**: um módulo novo e pequeno nomeia a relação
(`describeRelation`); o cabeçalho de Plano/Rotina para de repetir o stepper
de 5 pontos herdado de Entrega e passa a mostrar a mesma contagem que o
corpo já mostra; a barra de Entrega ganha um rótulo que deixa claro que é
"progresso do fluxo", diferente de "conclusão"; "Faz parte de" ganha volta em
toda tela; um card não pode mais ficar em dois planos ao mesmo tempo
(índice único); um tipo configurado como Plano em Configurações passa a ser
tratado como Plano em todo lugar.

**Invariantes que a execução não pode quebrar** (ver seção 19 para a lista
completa de testes que os cobrem):
- Remover um card de um Plano nunca apaga o card.
- A identidade de uma etapa/execução continua sendo o hash determinístico —
  nenhum retry pode criar duplicata.
- Um filho pode continuar tendo vários pais quando o `slot` NÃO é nulo
  (etapa de fluxo) — o índice único novo só vale para `slot IS NULL`.
- Uma entrega recorrente continua nascendo com o molde sem etapas.
- Status/data/responsável espelhados de um pai de fluxo continuam calculados
  na leitura, nunca persistidos na linha do pai.
- Um Plano continua nunca podendo ser uma Entrega (CHECK já existente).

## 13. Mudanças frontend

- **`app/admin/TaskModal.tsx`** — cabeçalho de um card `isRollupParent &&
  !isFlow` (Plano, Rotina-molde) passa a mostrar uma contagem de conclusão
  consistente com o corpo (ex.: "6 de 7 concluídas"), no lugar do stepper de
  5 pontos hoje compartilhado com Entrega. Rótulo de progresso da Entrega
  passa a dizer "progresso do fluxo"; Plano/Rotina passam a dizer
  "conclusão" — mesma fórmula numérica de hoje, só o nome deixa de sugerir
  que é a mesma coisa nos dois casos.
- **`app/admin/KanbanBoard.tsx`** — `onOpenRelatedTask`/estado do modal
  (~linha 1101) ganha a mesma pilha de histórico que `CardModalLauncher.tsx`
  já tem, extraída para um hook pequeno compartilhado pelos dois
  (`useRelatedTaskHistory` ou nome equivalente), em vez de duplicar a
  lógica.
- **`app/admin/CardParentBox.tsx`** — passa a rotular a relação usando os
  4 rótulos estáveis da nova camada semântica (seção 14), em vez de inferir
  ad hoc a partir de `isFlowDelivery`/`kindDef().isPlan`/
  `recurrence_cadence` combinados na própria tela.
- **`app/admin/operacao/ParentCardsBoard.tsx`** — mesma troca de rótulo de
  progresso para Plano/Rotina que o `TaskModal`.
- Nenhuma mudança de CSS pixel-perfect nesta fase — deixado para a execução,
  guiada pelas skills de frontend/dashboard já usadas nesta investigação
  (hierarquia visual, densidade, paleta).
- Estados vazio/carregando/erro das telas afetadas não mudam de mecanismo —
  a mudança é só de rótulo/contagem exibidos quando os dados já chegaram.

## 14. Mudanças backend (se necessárias)

- **Novo módulo puro `lib/taskRelationSemantics.ts`**:
  `describeRelation(parent, child, link)` devolve um de 4 rótulos estáveis
  (`contains | is_step_of | is_occurrence_of | shares_step_with`) a partir
  dos sinais que já existem hoje (`isFlowDelivery`, `link.slot`,
  `recurrence_parent_id`, `kindDef().isPlan`) — nenhum sinal novo é
  introduzido, só uma leitura centralizada dos que já existem.
- **`lib/flows/parentBoxes.ts`** (`relevantParentRelationKinds`) e
  **`lib/comments.ts`** (`isFamilyParent`/família) passam a consumir essa
  camada em vez de repetir a combinação de sinais cada um à sua maneira —
  mesmo comportamento observável, uma fonte de verdade só.
- **`lib/taskCatalog.ts`** (`kindDef()`): passa a consultar
  `task_types.behavior` também para kinds sem entrada embutida no código
  (hoje só os 5 kinds builtin são reconhecidos como Plano/Entrega/Simples).
  Aditivo — os 5 builtins continuam com o comportamento atual inalterado.
- Nenhuma rota de API muda de contrato nesta fase; a única mudança de
  comportamento observável de backend é a rejeição de um segundo elo de
  plano no mesmo card (seção 15/17).

## 15. Mudanças no banco (se necessárias)

Uma única migração pequena e reversível:

```sql
create unique index concurrently if not exists task_links_um_plano_por_filho
  on task_links (child_id) where slot is null;
```

Aplicada em duas etapas seguindo o padrão já usado em
`20260829180000_plano_nao_e_entrega.sql`: primeiro checar produção por
violações existentes (`select child_id, count(*) from task_links where slot
is null group by child_id having count(*) > 1`), e só então criar o índice.
Se houver violação real, ela precisa ser resolvida manualmente (decidir qual
elo é o correto) ANTES da migração — não é esperado nenhuma, mas não foi
verificado neste documento (é uma leitura de produção que a etapa de
execução deve fazer primeiro, ver seção 23, passo 0).

Este índice só restringe `slot IS NULL` (membresia de plano) — não afeta o
padrão de etapa compartilhada da "diária de gravação" (esses elos sempre têm
`slot` preenchido).

## 16. Estratégia de compatibilidade/migração

- A migração do índice é aditiva e não destrutiva — não apaga nem altera
  dados, só passa a rejeitar uma inserção que hoje seria silenciosamente
  aceita.
- A leitura de `task_types.behavior` em `kindDef()` é puramente aditiva: para
  os 5 kinds embutidos, o comportamento não muda (continuam vindo do código);
  só kinds SEM entrada embutida passam a herdar classificação do banco — não
  existe caso hoje em que isso mudaria o comportamento observável de um kind
  já em uso (precisa ser confirmado por teste, seção 19).
- A camada semântica é pura e nova — nenhum consumidor existente quebra
  porque nada é removido, só centralizado.
- Rollback: o índice pode ser dropado sem perda de dado; a camada semântica e
  a mudança de rótulo/contagem no frontend podem ser revertidas por
  reverter o commit, sem migração de dado associada.

## 17. Fases de implementação

Cada fase deixa o sistema utilizável — nenhuma depende de "big bang".

**Fase 0 — Higiene, sem mudança visível ao usuário.**
- Ler produção para confirmar ausência de violação da regra de plano único
  antes de criar o índice.
- Migração do índice único parcial (seção 15).
- `kindDef()` passa a consultar `task_types.behavior` para kinds sem entrada
  embutida.
- Opcional: comentário de "morto, mantido só por compatibilidade de PATCH
  antigo" no topo de `lib/taskDateGrouping.ts`, sem apagar nada.

**Fase 1 — Camada semântica.**
- Criar `lib/taskRelationSemantics.ts` com `describeRelation`, com testes de
  tabela cobrindo as 4 relações + o caso combinado (execução de recorrência
  que também é entrega de fluxo).
- Migrar `relevantParentRelationKinds` e a lógica de família de
  `lib/comments.ts` para consumir essa camada, sem mudar comportamento
  observável (cobrir com os testes e2e existentes como regressão).

**Fase 2 — Legibilidade (o ganho visível principal para o usuário).**
- Cabeçalho de Plano/Rotina no `TaskModal.tsx` passa a mostrar contagem de
  conclusão, não o stepper de 5 pontos de Entrega.
- Rótulos de progresso distintos (Entrega: "progresso do fluxo"; Plano/
  Rotina: "conclusão").
- Pilha de "voltar" extraída para hook compartilhado, aplicada também ao
  `KanbanBoard.tsx`.

**Fase 3 (opcional, só se sobrar tempo) — Polimento visual.** Passar as
caixas de relação e linhas de membro pelas skills de frontend/dashboard já
disponíveis no repo (hierarquia, ícone consistente) — cosmético, depois das
fases que consertam compreensão real.

## 18. Arquivos/componentes provavelmente afetados

- `lib/taskRelationSemantics.ts` (novo)
- `lib/taskRelationSemantics.test.ts` (novo)
- `lib/taskCatalog.ts` (`kindDef`)
- `lib/taskCatalog.test.ts` (estender)
- `lib/flows/parentBoxes.ts` (`relevantParentRelationKinds`)
- `lib/comments.ts` (`isFamilyParent`, `familyCardsOf`)
- `app/admin/TaskModal.tsx` (cabeçalho de rollup, rótulo de progresso)
- `app/admin/KanbanBoard.tsx` (`onOpenRelatedTask`/estado do modal)
- `app/admin/CardModalLauncher.tsx` (fonte do padrão de pilha a extrair)
- `app/admin/CardParentBox.tsx` (rótulo de relação)
- `app/admin/operacao/ParentCardsBoard.tsx` (rótulo de progresso)
- `supabase/migrations/<novo>_task_links_um_plano_por_filho.sql` (novo)
- Hook novo compartilhado de histórico de navegação (nome a definir na
  execução, ex. `useRelatedTaskHistory` — extraído de `CardModalLauncher`)

## 19. Testes

**Domínio/backend**:
- `lib/taskRelationSemantics.test.ts` — tabela de casos cobrindo as 4
  relações e a combinação execução-de-recorrência+entrega-de-fluxo.
- `lib/taskCatalog.test.ts` — um kind custom com `task_types.behavior:
  'plano'` é tratado como `isPlan` em toda checagem (quadro, combobox,
  progresso); os 5 kinds embutidos permanecem com o comportamento atual
  inalterado.
- Teste de integração/migração: tentar criar um segundo elo `slot = null`
  para o mesmo `child_id` é rejeitado pelo índice; um elo com `slot`
  preenchido para múltiplos pais (padrão "diária de gravação") continua
  funcionando sem trombar no índice novo — **regressão obrigatória**,
  reexecutar `lib/flows/shootDayRows.test.ts`.

**Frontend**:
- Fixture com Plano 6/7 concluídos: cabeçalho e corpo mostram a mesma
  contagem (reprodução do caso real "BAITA - Plano de Agosto").
- Entrega com rótulo "progresso do fluxo" e número numericamente inalterado
  frente ao comportamento atual.
- Paridade de "voltar": abrir card relacionado a partir do Kanban e a partir
  de Operação produzem a mesma affordance de volta.

**E2E**:
- Estender `plan-delivery.spec.ts` e `parent-comment-and-partition.spec.ts`
  com a asserção de consistência cabeçalho×corpo.
- Novo spec reproduzindo o cenário real do achado da seção 2.
- Reexecutar sem alterar, como guarda de regressão: `flow-chain.spec.ts`,
  `flow-parent-mirrors-step.spec.ts`, `recurrence-action-plan.spec.ts`,
  `delivery-shape-parity.spec.ts`, `multi-date-task-group.spec.ts`,
  `comment-flow-step-crash.spec.ts`.

Cenários obrigatórios cobertos pela combinação acima: recorrência simples,
execução de recorrência, plano, plano com múltiplos cards, entrega em
cascata, etapa dentro de uma entrega, card em estruturas combinadas
(recorrência+fluxo+plano), associar um card existente a um plano, remover
essa associação, navegação entre os itens.

## 20. Riscos

- O índice único pode falhar de aplicar se já existirem, sem que a
  investigação tenha visto, cards com 2+ planos em produção — mitigado por
  checar antes de migrar (seção 15), seguindo o mesmo padrão já usado em
  `20260829180000` e `20260909180000` neste repositório.
- Ampliar `kindDef()` para consultar `task_types.behavior` amplamente pode
  mudar comportamento de algum tipo customizado ainda não descoberto em
  produção — mitigado por só ADICIONAR classificação a tipos sem entrada
  embutida, nunca sobrepor os 5 builtins, com teste explícito de que os 5
  builtins ficam inalterados.
- Mudanças em `KanbanBoard.tsx` tocam um arquivo grande e muito usado — a
  mudança deve ficar restrita ao caminho `onOpenRelatedTask`/estado do
  modal, não um refactor mais amplo.
- Mudar a leitura visual do cabeçalho de Plano/Rotina pode confundir quem já
  está acostumado com o stepper atual (mesmo sendo enganoso) — recomenda-se
  um aviso breve à equipe, no padrão das ATAs já usadas neste projeto.

## 21. Critérios de aceite

- Abrir "BAITA - Plano de Agosto" (ou fixture equivalente com status
  divergente dos membros) mostra um cabeçalho que não contradiz a contagem
  do corpo.
- O progresso de uma Entrega tem rótulo distinto do de Plano/Rotina; o
  número numérico da Entrega permanece igual ao de hoje.
- Clicar em "Faz parte de" a partir do Kanban e a partir de Operação
  (Entregas/Plano/Rotinas) oferecem a mesma affordance de voltar, e usá-la
  retorna ao card de origem exato.
- Tentar ligar um segundo Plano a um card já membro de outro é rejeitado
  (pelo índice), em vez de aceito silenciosamente.
- Um tipo customizado com `behavior: 'plano'` em Configurações passa a ser
  excluído do quadro Kanban e da busca "Vincular existente" de plano, como
  o Plano embutido já é.
- Todos os specs e2e listados na seção 19 como regressão continuam passando
  sem alteração — especialmente o padrão DAG da "diária de gravação".
- `npx tsc --noEmit`, `npm test`, `npm run build` (ou `npm run verify`)
  passam.

## 22. Itens explicitamente fora de escopo

- **R4.10** (repensar "automação vira card", target type dedicado) —
  já é um item de roadmap separado; este documento só registra a interação
  (seção 8), não o resolve.
- Tabela de relações genérica / grafo — avaliada como Alternativa B e
  rejeitada por falta de evidência de necessidade (seção 11).
- Plano dentro de Plano / CTE recursivo em `listParentCards` (**R2.4**) —
  sem evidência de necessidade real hoje; permanece item à parte.
- Reescrever o motor de cascata, o schema de `task_links` ou o uso de
  `plan_id` pela recorrência — confirmados sólidos e testados; nenhuma
  mudança proposta aqui.
- Qualquer implementação de IA/NorthAi — a camada semântica (seção 14) é
  preparada para consumo futuro, mas nenhuma lógica de IA é escrita nesta
  evolução.
- CSS pixel-perfect — fica para a sessão de execução, guiada pelas skills de
  design já disponíveis no repositório.
- Limpeza/remoção do código morto de grupos de data explícita — só
  sinalização opcional (comentário), não remoção, nesta evolução.

## 23. REGRA MAIS IMPORTANTE

As hipóteses recebidas junto com o pedido original (nova tabela de relações,
grafo, `parent_id` novo, refazer o Kanban, motor de workflow genérico) **não
foram usadas para decidir a solução** — serviram só para apontar ONDE
investigar. A recomendação da seção 12 emergiu da leitura direta do schema,
das migrações, do código de runtime e da navegação real em produção, e
contraria diretamente a maioria das hipóteses originais (nenhuma exigiu uma
tabela nova, um grafo, ou refazer o Kanban). Qualquer desvio dessa regra
durante a execução — adaptar a implementação de volta para uma das hipóteses
originais sem evidência nova que a justifique — deve ser tratado como um erro
de processo, não uma escolha de engenharia válida.

---

## INSTRUÇÕES PARA O SONNET

Ao iniciar a sessão de execução, antes de tocar em qualquer código:

1. **Reverificar as premissas.** Ler novamente os arquivos citados nas
   seções 3–10 (especialmente `lib/taskCatalog.ts`, `lib/taskRelations.ts`,
   `lib/flows/advance.ts`, `lib/supabase.ts` nas linhas citadas) e confirmar
   que ainda descrevem o comportamento atual — este documento foi escrito em
   2026-09-16; se algo já mudou, ajustar o plano antes de prosseguir, não
   forçar o código a bater com o documento.
2. **Fase 0** (seção 17):
   a. Rodar em produção (via MCP do Supabase, só leitura) a query de
      violação do índice único da seção 15. Se houver alguma linha, PARAR e
      reportar ao usuário antes de prosseguir — não decidir sozinho qual elo
      manter.
   b. Escrever e aplicar a migração do índice (seção 15), seguindo o padrão
      `not valid` → `validate` já usado em `20260829180000` e
      `20260909180000`.
   c. Ajustar `kindDef()` em `lib/taskCatalog.ts` para consultar
      `task_types.behavior` para kinds sem entrada embutida. Escrever o
      teste que confirma os 5 builtins inalterados ANTES de mudar o código.
   d. Rodar `npm run verify` — deve passar sem nenhuma mudança visível na
      UI ainda.
3. **Fase 1**: criar `lib/taskRelationSemantics.ts` com testes de tabela
   primeiro (TDD), depois migrar `parentBoxes.ts` e `comments.ts` para
   consumi-lo, confirmando com os e2e existentes que nada observável mudou.
4. **Fase 2**: mudanças de frontend descritas na seção 13. Para cada uma,
   capturar screenshot antes/depois (via browser real, usuário autenticado
   como Allan em northportal.vercel.app ou ambiente local) do caso "BAITA -
   Plano de Agosto" (ou fixture equivalente) mostrando a correção do
   cabeçalho×corpo.
5. **Testar entre cada fase**, não só no final: TS/unit/integration/build
   depois de cada fase; e2e completo (incluindo os specs de regressão da
   seção 19) antes de considerar qualquer fase concluída; revisão manual no
   browser em pelo menos 2 larguras de viewport para as mudanças de Fase 2.
6. **Preservar decisões e não expandir escopo**: nenhuma implementação de
   IA, nenhuma reconstrução do NorthAi, nenhum refactor genérico além do
   listado na seção 18, nenhuma dependência nova. Se durante a execução
   parecer que uma das hipóteses originais (grafo, `parent_id` novo, etc.)
   seria "mais elegante" para algum detalhe encontrado, tratar isso como
   sinal de alerta (ver seção 23) e voltar para o usuário antes de mudar de
   direção.
7. **Registrar desvios do plano** junto ao próprio documento (uma seção
   "Desvios" ao final deste arquivo, ou um adendo separado) sempre que a
   implementação real precisar se afastar do que está descrito aqui —
   com a justificativa.
8. **Relatório final exaustivo**: fases executadas; arquivos/migrações/
   componentes/APIs alterados; comportamento antes/depois; decisões
   preservadas; desvios e justificativas; testes rodados; screenshots;
   teste com dados legados reais (não só fixtures novas); riscos
   remanescentes; próximos passos não implementados.
