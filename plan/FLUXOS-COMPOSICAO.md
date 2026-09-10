# Composições de fluxo ainda não suportadas (P2-E)

Investigação lida no código (agente E, revisão multi-agente ESTRATEGIA-FLUXOS.md,
2026-09-09). **Só investigação — nada abaixo foi implementado.** Cobre os quatro
pedidos listados em P2-E, na ordem do documento de estratégia.

Achado que vale para os quatro: `task_links` (migração
`20260828210000_task_types_e_links.sql`) não tem NENHUMA restrição de tipo —
é `(parent_id, child_id, slot, position)` com só `primary key (parent_id,
child_id)` e `check (parent_id <> child_id)`. Não há FK nem trigger que exija
"o pai é um Plano" ou "o filho é do mesmo `kind` do pai". Toda regra de "quem
pode ser filho de quem" mora em código de aplicação (rotas + filtros de UI +
`taskProgress`), não no schema. Por isso **nenhum dos quatro itens precisa de
migração de schema** — o que muda, quando muda, é validação de rota, filtro de
UI e a matemática de `dedupePlanMembers`. O único item com uma "migração" de
verdade é o 4, e é uma migração de DADOS (uma linha nova em `task_types`), não
de schema.

---

## 1. Vincular um Plano de Ação diretamente a um card PAI ou a um card FILHO

### Estado hoje
`POST /api/admin/tasks` (`app/api/admin/tasks/route.ts:153`) decide sozinho:
```ts
if (planLink) await linkTasks(planLink, flow ? flow.delivery.id : task.id);
```
Ao criar uma Entrega com um `plan_id` já escolhido no mesmo request, o elo vai
sempre para a ENTREGA (`flow.delivery.id`), nunca para a primeira etapa
(`task.id` só é usado quando não há `flow`, i.e. quando o tipo não é entrega).
Isso é uma decisão CORRETA nesse momento específico: no instante da criação só
a entrega existe como "o card que representa a peça inteira" — a etapa é
um detalhe interno que a pessoa nem escolheu.

### O que já funciona, sem mudar nada
Para um card **já existente** (plano e card já salvos), `PlanMemberComposer`
(`app/admin/TaskModal.tsx`, busca "+ Buscar ou criar atividade…") já deixa
ligar QUALQUER card do cliente que ainda não tenha outro Plano — inclusive uma
ETAPA de uma entrega:

- `linkableCandidates` (`TaskModal.tsx:728-733`) filtra só
  `!kindDef(t.kind).isPlan && !t.recurrence_cadence && !planParentIdOf(t)`.
  Não filtra por `deliveryParentIdsOf(t)` — uma etapa (elo COM slot para a
  entrega) passa o filtro porque `planParentIdOf` só olha elos SEM slot.
- O servidor (`POST /api/admin/tasks/[id]/relations`) não valida `kind` nem
  bloqueia um card que já tem outro pai; só valida `child.subtype === slot`
  quando `slot` é passado — e ligar a um Plano é sempre `slot: null`.

Ou seja: **hoje já é possível** abrir um Plano, buscar pelo título de uma
etapa (ex.: "— Roteiro") e ligá-la direto, sem tocar a entrega. O que falta é
só descoberta/UX (nada no picker diz "isto é uma etapa de uma entrega") — não
é um bug de dado.

### O que falta de fato
Só o CAMINHO DE CRIAÇÃO (`POST /api/admin/tasks?scope=task` com `plan_id` no
mesmo body) não deixa escolher "ligue ao PASSO, não à entrega" — porque no
momento da criação só existe um passo (o primeiro), e ligar o pai é a leitura
certa. Não há aqui um pedido real de mudança: se alguém quiser depois que o
Plano aponte para um passo específico em vez da entrega, o caminho já existe
(desligar da entrega pelo ✕ na caixa "Atividades do plano", religar pela
busca). Meu veredito: **não implementar nada novo** — documentar que o
caminho já existe, e melhorar o rótulo do resultado de busca do
`PlanMemberComposer` para mostrar "Etapa de <Entrega>" quando o candidato tem
`deliveryParentIdsOf(t).length > 0`, para a pessoa saber o que está ligando.

### Migração
Nenhuma. Mudança de UI opcional (rótulo no picker), sem tocar em rota nem em
schema.

### Risco
Nenhum novo: o caminho já passa pelas mesmas guardas de sempre
(`dedupePlanMembers`, `progressOf` com `seen`). Uma etapa ligada direto a um
Plano (sem a entrega também ser membro) NÃO é deduplicada por
`dedupePlanMembers` hoje — mas também não precisa ser: ela só duplicaria peso
se a ENTREGA da etapa TAMBÉM fosse membro do mesmo Plano, cenário que já é
coberto pelo teste existente (`lib/flows/flowProgress.test.ts`,
"dedupePlanMembers — a peça não conta cinco vezes").

---

## 2. Um fluxo (Entrega) ter como filho um Plano de Ação

### Estado hoje — um buraco real, não só uma falta de feature
`POST /api/admin/tasks/[id]/relations` (`app/api/admin/tasks/[id]/relations/route.ts`,
o botão de corrente — não confundir com `app/api/admin/tasks/[id]/route.ts`,
que é o PATCH do card) só valida:
```ts
if (slot && child.subtype !== slot) throw new HttpError(400, "...");
```
**Não valida `child.kind === parent.kind`.** A única coisa que impede hoje um
Plano de virar etapa de uma Entrega pela INTERFACE é `chainCandidates`
(`TaskModal.tsx:778-788`), que filtra `t.kind === chainDelivery.kind` — um
filtro client-side. Uma chamada direta à rota com
`{ child_id: <um plano_acao>, slot: "roteiro" }` **passaria** se por acaso
(ou de propósito) esse Plano tivesse `subtype: "roteiro"` — `subtype` é TEXT
livre em qualquer `kind` (`lib/validation.ts` não restringe `subtype` por
`kind` fora do trigger `tasks_valida_vocabulario`, que valida `subtype` contra
o vocabulário do `kind` DO PRÓPRIO CARD, não do pai a que ele seria ligado).

### O que aconteceria se isso ocorresse (rastreado, não hipotético)
- **Sem crash.** `flowStepKeyOf` lê só `task.subtype`; `FlowStepsBox` acha o
  card pelo `subtype` batendo com a etapa e renderiza normal — só que com o
  ícone/tom de Plano (◆ verde) no lugar do ícone da entrega, o que é
  visualmente incoerente mas não quebra nada.
- **Progresso não estoura a pilha.** `isRollupParent` reconhece o Plano como
  rollup (`kindDef(kind).isPlan`) independente de estar num slot; `progressOf`
  recursa nele normalmente contanto que `membersByParent` (o mapa vindo de
  `childrenByParent(clientTasks)`) contenha os MEMBROS do plano — que
  contém, porque o mapa é genérico por `parent_id`, não filtrado por "tipo de
  relação". A guarda `seen` seguraria um ciclo (Plano→Entrega→Plano) se
  alguém also linkasse a entrega de volta como membro do próprio Plano.
- **Família de comentários não duplica nem quebra**, mas fica estranha:
  `familyCardsOf(entrega)` inclui o Plano como "etapa" e mescla só o
  `payload.comments` DELE (não desce nos membros do Plano — `familyCardsOf`
  tem 1 nível só). Abrir o Plano por conta própria continua mesclando os
  PRÓPRIOS membros dele (`isFamilyParent` é `true` por `kindDef.isPlan`,
  independente de ele estar num slot de outra coisa) — ou seja, o Plano tem
  DOIS "family roots" concorrentes dependendo de por onde é aberto. Não
  crasha, mas é uma leitura confusa que ninguém pediu.
- **`belongsToTaskScreen` exclui QUALQUER `plano_acao`** do quadro Tarefas
  independente de slot — então o card nunca aparece "perdido" numa coluna;
  ele só é alcançável pela caixa de Etapas ou abrindo direto.

### Se isso for uma feature desejada (não um acidente a bloquear)
Dá pra decidir dos dois jeitos:
- **(a) Bloquear de vez** — defesa em profundidade: adicionar
  `if (child.kind !== parent.kind) throw new HttpError(400, ...)` na rota de
  relations quando `slot` é passado. Fecha o buraco descrito acima. Baixo
  risco, sem migração.
- **(b) Suportar de propósito** — um Plano dentro de uma etapa é
  conceitualmente "esta etapa é grande o bastante para ter sub-tarefas
  próprias". Para isso funcionar de forma coerente (não só sem crashar):
  - `chainCandidates` ganha uma exceção explícita para `kindDef(t.kind).isPlan`,
    já que Planos não têm `subtype` que combine com o vocabulário de etapas —
    a comparação teria que ser "é um Plano" OU "é do mesmo tipo", não só tipo.
  - A rota de relations passa a aceitar isso deliberadamente (não bloquear
    por kind quando o filho é um Plano), e documentar por quê.
  - `dedupePlanMembers` não precisa mudar (ele deduplica MEMBROS DE PLANO que
    também são etapa de uma Entrega do mesmo Plano — cenário ortogonal).
  - `familyCardsOf`/`isFamilyParent` (`lib/comments.ts`) precisam de uma
    decisão explícita: a etapa-que-é-Plano deveria mesclar SÓ os próprios
    comentários (comportamento atual) ou também os dos membros do Plano
    quando vista PELA entrega? Recomendo manter "só os próprios" — descer dois
    níveis (entrega → etapa-plano → membros do plano) é a fonte de bug mais
    provável (thread gigante, sem discriminador de origem — R2.5 do roadmap
    já é dívida conhecida nesse ponto).

### Migração
Nenhuma. Mudança de validação de rota (opção a) ou de rota + filtro de UI
(opção b).

### Risco
Real e HOJE (não é hipotético de feature futura): o buraco em (a) já existe
em produção — qualquer chamada direta à rota de relations pode produzir essa
combinação por acidente (um script, um teste, um usuário avançado usando a
API). Recomendo fechar com (a) independente de decidir (b) depois.

---

## 3. Um Plano de Ação ter como filho um card recorrente

### Precisa separar MOLDE de OCORRÊNCIA
"Card recorrente" tem dois sentidos na base:
- **Molde** — a linha com `recurrence_cadence` não-nulo (`tasks.recurrence_cadence`).
- **Ocorrência/execução** — a linha criada por ciclo, com `recurrence_cadence: null`
  sempre (`lib/recurrence.ts:149`, `recurringExecutionFields`) e o vínculo com
  o molde via `payload.recurrence_parent_id` (lido por `recurrenceParentIdOf`).

### Ocorrência: já funciona hoje
`linkableCandidates` (`TaskModal.tsx:732`) filtra `!t.recurrence_cadence` — e
uma OCORRÊNCIA sempre tem `recurrence_cadence: null`. Ela passa o filtro hoje
mesmo. Nada a fazer aqui.

### Molde: bloqueado só por esse filtro, e a mudança é segura
O filtro `!t.recurrence_cadence` existe para excluir o MOLDE. Removê-lo
(deixando o molde ser membro de um Plano) é uma mudança de UMA LINHA
(`TaskModal.tsx:732`, tirar essa cláusula), e a `relations`/`PATCH` route já
aceitam isso sem validação extra hoje — testei a leitura: nenhuma rota
verifica `recurrence_cadence` antes de escrever um elo.

Por que isso é seguro, e não só "não crasha":
- `isRollupParent` já trata `recurrence_cadence` truthy exatamente como
  `isPlan`/`flow_parent` — o molde já é um rollup parent hoje, e
  `taskProgress`/`progressOf` já generalizam rollup-dentro-de-rollup (o mesmo
  caminho testado em `flowProgress.test.ts` → "rollup aninhado — resolve uma
  entrega que é membro de um Plano de Ação" vale, sem mudança de código, para
  QUALQUER `isRollupParent`, molde de recorrência incluso).
- `belongsToTaskScreen` já exclui o molde do quadro Tarefas independente de
  ele ganhar um Plano como pai — comportamento já uniforme com Entrega/Plano.

### O risco real: `dedupePlanMembers` não conhece recorrência
```ts
export function dedupePlanMembers(members, membersByParent) {
  ...
  if (member.payload?.[FLOW_PARENT_KEY] !== true) continue; // só Entrega
  ...
}
```
Ele só deduplica um membro que é etapa de uma ENTREGA também presente na
lista. Se alguém ligar o MOLDE de recorrência a um Plano e, no mesmo Plano,
TAMBÉM ligar uma execução antiga dele à mão (hoje já possível, ver seção
acima), essa execução pesaria DUAS vezes: uma vez direto, uma vez dentro do
rollup do molde. É o "peso duplicado" que a estratégia pediu para checar —
confirmado, é real, só que é um caso de borda incomum (teria que ligar as
duas pontas à mão) e não específico de recorrência: o MESMO buraco já existe
para Entrega hoje se alguém ligar a entrega E uma etapa dela ambas ao mesmo
Plano SEM que `dedupePlanMembers` seja chamado com o mapa certo (ele já
protege esse caso specificamente para Entrega — só não generaliza).

### Recomendação
1. Liberar o molde em `linkableCandidates` (1 linha).
2. Generalizar `dedupePlanMembers`: em vez de testar
   `payload[FLOW_PARENT_KEY] === true`, testar `isRollupParent(member)` (já
   importável de `lib/taskCatalog.ts`) e usar `membersByParent.get(member.id)`
   genericamente — cobre Entrega E molde de recorrência com o mesmo código,
   e é estritamente mais correto que o que existe hoje (não é regressão:
   `isRollupParent` inclui o caso `flow_parent === true` que já era testado).
3. Adicionar o teste que falta em `lib/flows/flowProgress.test.ts`: molde de
   recorrência como membro de Plano, rollup correto; e o caso de borda do
   parágrafo anterior (molde + execução do molde ambos ligados ao mesmo
   Plano → execução não conta duas vezes).

### Migração
Nenhuma.

---

## 4. Criar um tipo-entrega novo do zero pela tela "Configurações › Etapas"

### Não funciona ponta a ponta hoje, e o próprio código diz por quê
`app/api/admin/task-types/route.ts` (comentário no `POST`):
> "Tipo de topo não nasce por aqui: ele tem contraparte em
> `lib/taskCatalog.ts` (tom, ícone, união `TaskKind`), e uma linha só no banco
> renderizaria com o visual de fallback em todo card."

Confirmado lendo os dois lados:
- **Banco**: o trigger `tasks_valida_vocabulario`
  (`supabase/migrations/20260831120000_higiene_modelo_tarefas.sql`) exige que
  `kind` exista como linha de TOPO em `task_types` (`parent_id is null`) antes
  de qualquer card daquele `kind` poder ser gravado. A tela de Configurações
  (`createTaskSubtype`, `lib/taskTypes.ts:254+`) só cria SUBTIPOS
  (`parent_id` obrigatório) — não existe rota nem botão para criar a linha de
  TOPO. Ou seja, mesmo se o código do catálogo estivesse pronto, a TELA não
  deixa criar o tipo — só editar/adicionar etapas de um tipo que já existe.
- **Código**: `lib/taskCatalog.ts` define `TaskKind` como união fechada
  (`"operacional" | "plano_acao" | "criativo" | "checkpoint_comercial" |
  "relatorio_conversao"`) e `TASK_KINDS` como um `Record` sobre essa união.
  `canonicalTaskClassification` (a função que TUDO no app usa para ler o
  `kind` de um card) cai em:
  ```ts
  return { kind: isTaskKind(kind) ? kind : "operacional", subtype: subtype ?? null };
  ```
  Um `kind` que existe em `task_types` mas não em `TASK_KINDS` é lido como
  `"operacional"` em TODO lugar que usa `kindDef`/`kindLabel`/`kindIcon`/
  `kindTone` — não é "cai pro visual cinza genérico só no ícone": o card
  passa a ser tratado como Tarefa comum para fins de tom, ícone e
  `performance` (a flag que decide se ele aparece em Performance). A
  mecânica da CASCATA (criação de etapas, avanço, progresso) continua
  funcionando, porque `createFlowDelivery`/`advanceFlow`/`isRollupParent`
  leem `task_types` (banco) e `payload.flow_parent` — nenhum dos dois depende
  do catálogo em código. O que quebra é só apresentação, mas "só" é
  relativo: o tipo fica publicamente ilegível (aparece como "Tarefa" em
  todo card, some do Performance) até alguém tocar código.

### Onde exatamente quebra, passo a passo
1. Admin vai a Configurações › Etapas — não há botão "+ Novo tipo" (só "+
   Etapa em <tipo existente>"). **Já para aqui pela tela.**
2. Se alguém inserir a linha de topo direto no banco (via MCP/SQL, como o
   `CLAUDE.md` descreve para migrações aplicadas fora do `db push`) com
   `behavior: 'entrega'`, `creatable: true`, mais os subtipos pela própria
   tela (isso SIM funciona — `createTaskSubtype` não tem essa limitação):
   - `GET /api/admin/task-types` devolve o tipo novo; o dropdown de Tipo no
     `NewTaskButton`/`TaskModal` (`creationTypes`, que usa `type.label` DIRETO
     do banco, não `kindLabel`) mostra o rótulo CORRETO na hora de criar.
   - `POST /api/admin/tasks?scope=task` com esse `kind` funciona:
     `taskBehaviorOf`/`createFlowDelivery` leem `task_types`, materializam a
     1ª etapa, tudo certo.
   - A partir daí, TODO OUTRO lugar que renderiza o card (Kanban, Calendário,
     o próprio modal fora do dropdown de criação, busca) usa `kindLabel`/
     `kindIcon`/`kindTone`/`kindDef(...).performance`, que caem no fallback
     `"operacional"` → aparece como "Tarefa" cinza, some do Performance.

### Recomendação
Duas correções independentes, nenhuma delas migração de schema:
1. **Curto prazo, documentar o processo de duas etapas** (o que já é o modelo
   do resto do repo para vocabulário): inserir a linha de topo em
   `task_types` (SQL/MCP, adicionar o arquivo do INSERT/migração ao repo à
   mão, como o `CLAUDE.md` já pede para qualquer migração aplicada por fora)
   **e** adicionar a entrada correspondente em `lib/taskCatalog.ts`
   (`TaskKind` + `TASK_KINDS`) no mesmo deploy. Sem isso, "criar um tipo
   novo" nunca vai ser self-service pela tela — é uma limitação deliberada
   documentada no próprio código, não um bug a corrigir.
2. **Médio prazo, se o pedido for repetido**: ampliar a tela para também
   criar a linha de topo (formulário simples: rótulo, comportamento,
   ícone/tom escolhidos de uma paleta fixa) E fazer `kindDef` consultar
   primeiro `task_types` (rótulo já vem de lá) antes do fallback de
   `TASK_KINDS`, com ícone/tom default genéricos quando o tipo não tem
   entrada em código. Isso é a mudança que fecha o gap de vez, mas é
   refactor de superfície ampla (todo lugar que chama `kindLabel`/`kindIcon`/
   `kindTone` passaria a precisar do resultado de `listTaskTypes`, hoje só
   assíncrono) — fora do escopo de um ajuste pontual.

### Migração
Nenhuma migração de SCHEMA. Criar o tipo em si é uma migração de DADOS (INSERT
em `task_types`) sempre que alguém quiser um novo tipo-entrega — isso já é
esperado e documentado (`CLAUDE.md` → "Production Supabase" / `DEPLOY.md` →
"Supabase migrations").

---

## Resumo — o que dá pra fazer sem tocar em `app/`/`lib/` de produção

| Item | Precisa de migração? | Tamanho da mudança | Risco principal |
|---|---|---|---|
| 1. Plano → pai ou filho direto | Não | Nenhuma (já funciona); rótulo de UI opcional | Nenhum novo |
| 2. Entrega com Plano como etapa | Não | 1 `if` na rota de relations (bloquear) ou rota+UI (suportar) | Buraco de validação já existe HOJE, independente de decidir suportar a feature |
| 3. Plano com molde de recorrência como membro | Não | 1 linha de filtro + generalizar `dedupePlanMembers` | Peso duplicado em borda rara (mesmo buraco pré-existente para Entrega, não é regressão) |
| 4. Tipo-entrega novo do zero | Migração de DADOS (não de schema) | INSERT em `task_types` + entrada em `lib/taskCatalog.ts`, sempre os dois juntos | Card renderiza como "Tarefa" genérica e some do Performance se o código não acompanhar o dado |
