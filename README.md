# Portal North

Aplicacao Next.js do Portal North para clientes, com rotas por slug, persistencia de briefing no Supabase e deploy na Vercel.

## Stack

- Next.js 15 App Router
- React 19
- TypeScript strict
- Zod
- Supabase REST via Edge Route Handlers
- Vercel Edge Runtime nas APIs
- CSS global com paleta e tipografia North

## URLs

- Producao: `https://north-portal-navy.vercel.app`
- Slug inicial: `/north`
- Projeto Vercel: `north-portal`
- Supabase Project ID: `svkogegypdqquzlfzaor`
- Supabase URL: `https://svkogegypdqquzlfzaor.supabase.co`

## Variaveis de ambiente

Crie as variaveis abaixo em Production, Preview e Development na Vercel:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://svkogegypdqquzlfzaor.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NORTH_ADMIN_TOKEN=
```

Nao commitar `.env`, `.env.local`, service role keys ou tokens administrativos.

## Rotas

- `GET /api/client/[slug]`: carrega cliente, briefing, links e resultados.
- `PATCH /api/client/[slug]/briefing`: salva o objeto completo de respostas do briefing.
- `PATCH /api/admin/client/[slug]`: atualizacao administrativa protegida por `Authorization: Bearer <NORTH_ADMIN_TOKEN>`.
- `/`: redireciona para `/north`.
- `/[slug]`: portal do cliente.

## Supabase

Tabelas utilizadas:

- `clients`
- `briefing_answers`
- `client_drive_links`
- `client_results`

Migration aplicada:

- `supabase/migrations/20260624000000_harden_client_portal.sql`

A migration habilita RLS, remove politicas publicas de escrita e mantem leitura publica apenas dos dados de clientes ativos.

## Desenvolvimento

Instale dependencias:

```bash
npm install
```

Rode localmente:

> Antes de abrir outra instancia, rodar build ou reiniciar o ambiente, consulte [Operacao local segura: portas e cache do Next.js](docs/OPERACAO-LOCAL-PORTAS.md). Uma unica instancia Next deve usar este checkout por vez.

```bash
npm run dev
```

Validacoes:

```bash
npm run lint
npm run typecheck
npm run build
npm run test        # vitest — unidades puras (validation, kanbanShared, approvalGroups)
npm run test:e2e    # playwright — fluxo de aprovacao do cliente contra o backend real
```

`test:e2e` sobe (ou reaproveita) o `next dev` local e usa `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_*` de `.env.local` para semear tasks reais, logar como `cliente@karpinski.com` de verdade e limpar tudo no final — não usa mocks.

## Administracao

Exemplo de atualizacao administrativa:

```bash
curl -X PATCH \
  "https://north-portal-navy.vercel.app/api/admin/client/north" \
  -H "Authorization: Bearer $NORTH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "brandUrl": "https://drive.google.com/...",
    "productsUrl": "https://drive.google.com/...",
    "uploadsUrl": "https://drive.google.com/..."
  }'
```

Tambem existem scripts auxiliares:

```bash
npm run seed:client -- north "ADM NORTH"
npm run update:client -- north '{"brandUrl":"https://drive.google.com/..."}'
```

Use `PORTAL_BASE_URL` para apontar os scripts para producao ou preview.

## Fluxo de Revisao e Aprovacao (Kanban)

O Kanban tem 6 colunas: `Entrada -> Em producao -> Revisao -> Aprovacao -> Concluido -> Publicado`. **Revisao é 100% interno** (equipe North); **Aprovacao em diante é 100% cliente** — todo card que chega em `aprovacao` pode ser visto (e aprovado) pelo cliente, independente do antigo flag `client_visible` (esse flag continua existindo só para o Plano de Acao, um recurso separado). Duas telas administrativas cross-cliente refletem esse fluxo, cada uma com um dropdown de cliente (inclui "Todos os clientes"):

### Modelo de tarefas v2 — kinds, Plano de Acao e progresso por workflow

A coluna `tasks.type` (enum criativo/agendamento/desempenho) virou `tasks.kind` **TEXT** livre (migration `20260706000008_task_model_v2.sql`), com um catalogo em codigo em **`lib/taskCatalog.ts`** (`TASK_KINDS`) como fonte unica de verdade do vocabulario — adicionar um kind ou mexer num percentual de workflow é uma mudanca de codigo la, sem migration. Kinds: `plano_acao`, `criativo`, `agendamento`, `planejamento`, `roteiro`, `gravacao`, `operacional` (+ `tasks.subtype` TEXT). O tipo **`desempenho` deixou de existir** — performance virou um atributo dos kinds elegiveis (`TASK_KINDS[kind].performance`: hoje `plano_acao` e `criativo`).

- **Plano de Acao é um card real** (`kind = plano_acao`), nao mais "qualquer card com `client_visible`". Tarefas comuns se vinculam a ele pela coluna `tasks.plan_id` (self-FK). Como ocorrencias recorrentes reservam essa coluna para o pai da recorrencia, o vinculo adicional delas fica em `payload.action_plan_id`. O portal "Plano de Acao" reconhece ambos e mostra os `plano_acao` client-visible, com faixa de datas (`start_date`/`end_date`) e progresso rollado.
- **Progresso é calculado, nunca digitado** (`payload.pct` foi removido). `taskProgress()` em `lib/taskCatalog.ts`: para cards normais é o percentual do `WORKFLOWS[kind]` pelo status atual; para um plano é a media ponderada (`progress_weight`) do progresso das tarefas membro. O atributo "Progresso" no modal/painel **só aparece em planos de acao**; cards normais derivam o progresso silenciosamente do status.
- **Revisor e Aprovador são atributos separados** (migration `20260706000009_task_approver.sql` adiciona `tasks.approver_id`). `reviewer_id` = REVISOR (admin, etapa de Revisao); `approver_id` = APROVADOR (cliente, etapa de Aprovacao). Escolher "Sem revisor" / "Sem aprovacao" pula aquela etapa (`requires_review`/`requires_approval` derivam da presenca do respectivo campo — nao ha mais toggle "Etapas"). A RLS `tasks client approve own` e a rota `/api/client/[slug]/tasks/[id]` chaveiam pelo `approver_id` (+ escalada de gerente).
- **Vinculo plano ↔ atividades, nos dois sentidos**: toda tarefa tem o atributo **Plano de Ação**. O dropdown grava `plan_id` em tarefas comuns e `payload.action_plan_id` em ocorrencias recorrentes; o modal de um `plano_acao` lista ambos os tipos de membro. O campo JSON e uma relacao secundaria, sem FK e sem migration. Somente a ocorrencia escolhida entra no plano; ciclos futuros nao herdam esse vinculo.
- **Colunas novas em `tasks`**: `kind, subtype, plan_id, approver_id, requires_review, requires_approval, start_date, end_date, scheduled_start_at, scheduled_end_at, progress_weight` (só colunas; nao ha tabela nova — o grafo geral de relacoes fica para uma 2a rodada).
- **Calendario** (`/admin/kanban` → Calendario) tem toggle **Mes/Semana**. Em **ambas** as visoes, `plano_acao` aparece como **barra horizontal** atravessando seu intervalo de datas (o mes é montado por semanas-linha para as barras poderem transpassar os dias); agendamentos aparecem no dia do `scheduled_start_at` com o horario; tarefas comuns no `due_date`.
- **Telas de Plano de Ação** (`ActionPlan`/`listActionPlans` em `lib/supabase.ts`): o **admin `/admin/plano`** virou um acordeão — cada plano expande mostrando suas atividades (kind/status/progresso), com botões "Abrir card" e "Editar" (abrem o `TaskModal` via `CardModalLauncher`). O **portal do cliente** (`PlanoPage`) mostra cada plano com progresso, faixa de datas e um dropdown "N atividades neste plano".
- **Modal (`TaskModal.tsx`) reorganizado por secoes**: tipo+subtipo → vinculo com plano → datas → revisor → aprovador → atributos por kind → progresso (só planos) → atividades do plano (só planos). O picker de "Nova tarefa" lista todos os kinds. `TYPE_LABEL`/`TYPE_TONE` (antes duplicados em 4 arquivos) sumiram — tudo importa de `lib/taskCatalog.ts` (`kindLabel`/`kindTone`).


- **`/admin/revisoes`**: fila com os cards da coluna **Revisao**. Acoes: "Ajustes" (volta para Em producao) ou "Enviar para aprovacao" (avanca para Aprovacao, limpando o `reviewer_id` — a proxima etapa precisa de um revisor do CLIENTE, nao mais o admin que revisou). **So o admin atribuido como revisor daquele card pode agir nele** — outro admin ve o card mas os botoes ficam desabilitados.
- **`/admin/aprovacoes`**: fila com os cards da coluna **Aprovacao** (sem mais separacao Interno/Cliente — nao fazia sentido, ja que Aprovacao inteira e cliente-facing) + secao "Concluidas" no fim (`aprovado`). "Aprovar"/"Reabrir" **exigem nivel gerente** (ver [Niveis de acesso](#niveis-de-acesso)); "Ajustes" **NAO move o card** — so anexa um comentario ao card, disponivel para qualquer admin. A coluna Publicado (`concluido`) continua so manual (arrastar no Quadro). Todo card tambem ganhou um botao **"Abrir card"** que abre o `TaskModal` completo (`CardModalLauncher.tsx`), carregando os revisores certos para o cliente daquele card sob demanda.

Backend: `lib/supabase.ts` expõe `listReviewQueue()` e `listApprovalQueue()`; filtros puros em `app/admin/approvalGroups.ts` (`reviewQueueRows`, `groupApprovalQueue` — so 2 grupos agora, `pending`/`resolved` — e `filterByClient`), com testes em `app/admin/approvalGroups.test.ts`. RLS (`20260706000004`/`20260706000005`) libera leitura e acao do cliente em qualquer card `aprovacao`/`aprovado`/`concluido` do proprio `client_id`, independente de `client_visible`.

### Lado do cliente: tela Feedbacks (`/[slug]#feedbacks`)

A tela **Feedbacks** do portal do cliente (`EntregasPage` em `app/[slug]/PortalPaged.tsx`) é 100% orientada a dados reais — sem mock:

- **Fila de aprovação**: mostra os cards do proprio cliente com status `aprovacao` (`payload.pendingApprovals`, calculado em `getPortalPayload`). O card cujo `reviewer_id` é o usuario logado (`payload.sessionUserId`) aparece primeiro e com a tag "Sua vez"; uma conta `gerente` do cliente também pode agir em qualquer card, mesmo atribuído a um `usuario` diferente (mostra "Aprovando como gerente da conta"). Sem revisor atribuido ou revisor de outra conta (e sem ser gerente), os botões ficam desabilitados (a API + a policy RLS `tasks client approve own` já impediam a ação — a UI só deixa isso explícito).
- **Aprovar entrega**: `PATCH /api/client/[slug]/tasks/[id]` com `{action:"aprovar"}` — leva o card para `aprovado` (Concluído), não mais direto para `concluido` (Publicado).
- **Solicitar ajustes**: abre um modal (`AdjustModal`) que exige um comentário antes de habilitar o envio. `PATCH .../tasks/[id]` com `{action:"ajustes", comment}` **mantém o card em `aprovacao`** (não muda de coluna) e só anexa o comentário a `payload.comments` (autor = nome do perfil de quem enviou, via `getProfileName`) — assim o time North vê o feedback direto no card, sem o card sumir da fila. É a mesma regra dos dois lados (cliente e admin).
- **Comentários visíveis no card**: tanto no Feedbacks do cliente quanto nas telas `/admin/revisoes` e `/admin/aprovacoes` e no Kanban (Quadro/Tabela), um card com comentários mostra um badge de contagem (💬 N) e a última mensagem em preview — ninguém precisa abrir o modal só para saber que há feedback pendente.
- **Link do material vem do comentário**: o botão "Abrir criativo"/"Ver material" em cada card pendente usa `extractLatestLink` (`lib/comments.ts`) — o último link colado em qualquer comentário do card vira o destino do botão (cai para o link de Drive do cliente se nenhum comentário tiver link ainda).
- **Histórico** (fim da página): cards do cliente em `aprovado` ou `concluido` (`payload.resolvedApprovals`); os que já estão em `concluido` ganham a tag **"Publicado"** (os demais, "Concluído").
- **Tempo real**: `lib/useTaskRealtime.ts` assina `postgres_changes` da tabela `tasks` (Supabase Realtime, habilitado via migration `20260706000003_tasks_realtime.sql`) e recarrega a página silenciosamente a qualquer mudança que a sessão possa ver pela RLS — usado tanto aqui quanto no Kanban admin (`KanbanBoard.tsx`), então uma aprovação feita no portal aparece no Quadro (e vice-versa) sem F5.

### Modal da atividade (admin `TaskModal.tsx`)

- **Progresso manual só em Desempenho**: o campo "Progresso (%)" generico foi removido do bloco "Como aparece no Plano de Ação" (client_visible) — agora so existe uma barra de progresso arrastavel (`<input type="range">` + numero) dentro da grade do tipo **Desempenho**. Criativo/Agendamento continuam com o progresso derivado automaticamente da etapa do Kanban (`STATUS_PCT` em `lib/supabase.ts`), e mostram uma dica de texto no lugar do campo removido.
- **Configuração de atributos dentro do modal**: uma seção colapsável "⚙ Atributos visíveis" (mesma lista/estilo `attrcfg-*` da tela Tabela) foi embutida no fim da grade do `TaskModal`, filtrada para os atributos do tipo do card em edição — toggles ali refletem/alteram o mesmo `localStorage` (`useAttrVisibility`) usado pelo Quadro e pela Tabela, então a grade do proprio modal reage ao vivo.

### Kanban: filtro "Todos os clientes"

O seletor de cliente do Kanban (`/admin/kanban`, todas as views — Quadro/Tabela/Calendário) ganhou a opção **"Todos os clientes"** (`slug === ""`), que busca `GET /api/admin/tasks` sem `slug` → `listAllTasks()` em `lib/supabase.ts`, cross-cliente, cada task já vindo com `clientName`/`clientSlug` (join com `clients`). Nesse modo cada card ganha um badge com o nome do cliente (Quadro e Tabela); criar tarefa fica desabilitado ("+ Tarefa" e "+ Adicionar tarefa" por coluna) já que criação exige saber de qual cliente é o card — basta escolher um cliente específico no dropdown para voltar a criar.

### Onboarding: resumo do briefing + export CSV

`/admin/onboarding` não linka mais para a tela de edição do cliente (fazia pouco sentido). Cada linha abre um modal (`BriefingModal.tsx`) com o resumo completo do briefing daquele cliente, question-by-question, usando os mesmos `briefSteps` (`app/[slug]/content.ts`) que o wizard do cliente preenche — perguntas sem resposta aparecem como "Sem resposta". Um botão **"⬇ Exportar CSV"** no rodapé, alinhado à esquerda, gera e baixa um CSV (Etapa/Card/Pergunta/Resposta, com BOM UTF-8 pra abrir certo no Excel) inteiramente no browser, sem rota nova. Backend: `listAllBriefings()` em `lib/supabase.ts` (uma query só, todas as respostas cruas de todos os clientes).

### Performance: métricas por card publicado

`/admin/performance` deixou de ser um link de atalho e virou a fonte real de resultados: lista cross-cliente (dropdown de cliente, "Todos" incluso) de cards **publicados** (status `concluido`), cada um com um botão "Editar métricas" abrindo um modal com o catálogo de métricas (`app/admin/metricDefs.ts` — `METRIC_DEFS`, no estilo do "Configurar atributos"). O catálogo prioriza métricas que hoje vêm (e no futuro virão automaticamente) de plataformas Meta — alcance, impressões, cliques, CTR, engajamento, custo, CPC, conversões — com "Agendamentos" propositalmente por último: é uma métrica secundária e ainda só manual (a plataforma não recebe contagem de agendamentos diretamente).

Nova tabela **`task_metrics`** (migration `20260706000006_task_metrics.sql`): uma linha por task (`task_id` único), `metrics` jsonb livre (comporta novas chaves do catálogo sem migration) + `source` (`'manual'` hoje, mais tarde `'meta_api'` ou similar). RLS: admin tudo, cliente só lê os próprios (pensando num Dashboard futuro). Backend: `listPublishedTasks()`/`upsertTaskMetrics()` em `lib/supabase.ts`; rotas `GET /api/admin/metrics` e `PATCH /api/admin/metrics/[id]`.

## Níveis de acesso

Todo `profiles.role` (`admin`/`client`) agora também tem um `profiles.level` (migration `20260706000007_profile_levels.sql`), com um CHECK amarrando os dois:

| role | levels | quem é |
|---|---|---|
| `admin` | `editor`, `gerente` | equipe North |
| `client` | `usuario`, `gerente` | um cliente pode ter várias contas — `usuario` (colaborador) e `gerente` (quem aprova em nome da empresa) |

**Regras (aplicadas na API, não só escondidas na UI):**
- **Um revisor nunca é um cliente antes da Aprovação, mas um aprovador pode ser da North.** `lib/supabase.ts` tem `listAdminReviewers()` (Revisão, admin-only) e `listApproverCandidates(clientId)` (Aprovação: as contas do cliente união com toda a equipe North) — `TaskModal`/`TaskDetailPanel` trocam de lista sozinhos com base no status do card (`reviewerStageFor` em `kanbanShared.ts`) e limpam o `reviewer_id`/`approver_id` ao cruzar essa fronteira.
- **Só o revisor atribuído age num card em Revisão** — `PATCH /api/admin/tasks/[id]` rejeita (403) tirar um card de `revisao` se `session.userId !== reviewer_id` daquele card.
- **Gerente sempre aprova/reabre; o aprovador designado (mesmo editor) também pode, no próprio card** — `canDecideApproval()` (`lib/validation.ts`) libera a transição para/de `aprovado` se `session.level === "gerente"` OU `session.userId === approver_id` do card; sem aprovador designado, só gerente decide. `/api/admin/metrics/[id]` (registrar métricas) usa um gate separado, `requireAdminManager()`.
- **Um cliente gerente aprova por qualquer `usuario` da mesma empresa** — a policy RLS `tasks client approve own` (`20260706000007`) libera `approver_id = auth.uid() OR is_manager()`; o mesmo vale na API (`/api/client/[slug]/tasks/[id]`) e na Feedbacks page (`isManager` em `PortalPaged.tsx`), que mostra "Aprovando como gerente da conta" quando não é o revisor original.
- `getSession()` (`lib/supabase/auth.ts`) lê role/level/client direto da tabela `profiles` (mesma fonte que a RLS usa via `is_admin()`/`current_client_id()`), não mais do JWT `app_metadata` — `supabase.auth.admin.createUser()` às vezes não propaga o `app_metadata` a tempo do trigger `handle_new_user` rodar, então confiar só no JWT tinha ficado inconsistente.
- **Responsável (`assignee`) agora pode ser vinculado a contas reais.** Tabela `task_assignees` (migration `20260804000001_task_assignees.sql`, many-to-many `tasks`↔`profiles`) coexiste com o texto livre legado em `tasks.assignee` (nomes de freelancers sem login). `lib/supabase.ts` faz merge dos dois em toda leitura (`mergeTaskAssigneeRow`/`mergeAssigneeDisplay`), então `TaskRecord.assignee` continua sendo a mesma string combinada de sempre — só a escrita (`AssigneePicker`, `setTaskAssigneeProfiles`) diferencia chip de conta real (grava em `task_assignees`) de nome digitado (grava no texto livre).

Contas de teste (`SenhaForte123!`): `admin@north.com` (gerente), `editor@north.com` (editor), `cliente@karpinski.com` (gerente do cliente), `colaborador@karpinski.com` (usuário do cliente). Contas reais da equipe North: `allan@north.com` (gerente), `cintia@north.com`/`luiza@north.com`/`alisson@north.com` (editor).

## Estado atual

O deploy compila e a pagina `/north` responde. Para a API funcionar em producao, configure as variaveis protegidas na Vercel. Sem `SUPABASE_SERVICE_ROLE_KEY`, `GET /api/client/north` retorna `503`.

## Design (Figma)

Arquivo: **Plataforma North · prod** — fileKey `I1nVg0mJH169Mv7IdVC67M` (o antigo `dqw8Ddrdfi6D8xjdkWwVo8` esta DESATUALIZADO; nao usar). Design system "Nevoa Sage" (claro, principal) + petroleo (escuro), Fraunces + Inter, glassmorphism. Manual de marca em `design_system.md`.

### Paginas de producao (interativas)
- **North · Publico** (`288:2`): Landing, Login (liquid glass), Planos, Como funciona, Quem somos, Politicas, Recuperar Senha, Sucesso, 404.
- **North · Cliente (Bussola)** (`269:2`): Home/bussola, Briefing, Central Comercial, Acessos & Pastas, Feedbacks, Documentos, Agenda, Time North, Plano de Acao, Dashboard, Menu bussola, Dropdown, Configuracoes.
- **North · Admin (Operacional)** (`295:2`): Clientes, Cadastro, Aprovacoes, Configuracoes, Documentos, Sucesso, e **Gestao de Tarefas** (ver abaixo).

### Gestao de Tarefas (Kanban + Tarefas unificados, inspirado no Notion)
Uma tela, 3 visualizacoes com toggle no header (Quadro / Tabela / Calendario):
- **Quadro** (`358:2`): board Kanban com 6 colunas — Entrada, Em producao, Revisao, Aprovacao, **Concluido**, Publicado —, cards com tags/prioridade/responsavel/prazo.
- **Tabela** (`358:72`): planilha estilo Excel — colunas Tarefa, Status, Prioridade, Responsavel, Prazo, Progresso (barra), Cliente; botao "⚙ Atributos".
- **Calendario** (`374:2`): grade mensal com tarefas posicionadas por prazo.
- **Detalhe** (`358:142`): board + painel lateral com todos os atributos (Status, Prioridade, Responsavel, Prazo, Progresso, Cliente, Tipo), descricao, atividade/comentarios.
- **Modal Documento** (`375:2`): preview do documento + metadados + acoes (Baixar, Compartilhar, Aprovar). Abre ao clicar num documento em `311:2`.
- **Config de Atributos** (`375:65`): painel Notion para definir tipo (Texto, Selecao, Pessoa, Data, Progresso, Relacao) e visibilidade de cada propriedade.

### Binding de tema Claro <-> Escuro
Tres paginas de revisao com cada tela em **claro (x=0) e escuro (x=largura+120) lado a lado**, jamais misturando temas:
- **North · Admin | L<->D** — 13 telas.
- **North · Cliente | L<->D** — 13 telas.
- **North · Landing | L<->D** — 11 telas.
Cada frame tem um botao flutuante de tema (canto inferior direito) que navega para a versao oposta no prototipo. O escuro e gerado por mapa de cor claro->escuro (snap por proximidade) preservando elementos ja escuros (sidebar/footer).

### Correcoes premium (sessao 8)
- **Header padronizado (cliente):** icone de bussola (circulo + 3 tracos, sem texto) como 1o item apos "PORTAL", antes de "Inicio", abrindo o menu bussola; **toggle de tema** (lua/sol) sempre entre o menu e o avatar. Propagado a todas as telas cliente. No landing, o toggle fica entre o menu e "Entrar".
- **Menu Bussola (overlay):** `306:2` = tema ESCURO (petroleo); novo `434:2` = tema CLARO (fundo bege/nevoa, caixas claras, linhas da bussola azul-escuras). O blur atras da bussola sempre sobrepoe a pagina atual. Rodape de links (Landing/Planos/Como funciona/Termos/Politicas) nos dois.
- **Glass diluido:** opacidade/blur reduzidos em Login, Recuperar Senha, Sucesso e 404 (mais transparente/premium).
- **Landing concluida:** hero slider (capa imagem), resultados em numeros (sem imagem), subdivisao Cases (Baita Conveniencia + Prime Detailing), depoimentos com imagens, footer.
- **Quem somos:** secao de C-levels (3 pessoas com foto: Pessoas & Cultura, Roteiros & Trafego, Producao & Execucao), metricas reutilizadas da LP e bussola pequena.
- **Nota front-end:** a bussola "segue o mouse" (agulha) e o hover-hold dos icones do menu sao comportamentos de codigo (JS), nao prototipaveis estaticamente no Figma.

### Correcoes premium (sessao 7)
- **Auth em light glass:** Login, Recuperar Senha, Sucesso e 404 reconstruidos em glassmorphism claro (nevoa sage + blobs + card refrativo) — antes estavam petroleo escuro no tema claro.
- **Sidebar admin sempre no tema certo:** recolorida para light no tema claro (nao mistura mais com o escuro).
- **Landing longa:** `293:2` agora tem ~3400px com Header + 3 secoes hero (principal com bussola glass; mock **Baita Conveniencia** com dashboard de metricas; mock **Prime Detailing / estetica automotiva** com agenda semanal) + Footer.
- **Bussola white glass:** disco de vidro branco sobrio com agulha bicolor sand/teal (light); versao petroleo no dark.
- **Toggle de tema:** icone ☾/☀ no header ao lado do menu do cliente (todas as telas), com funcao de toggle no prototipo; removido o botao flutuante inferior-direito. No admin permanece tambem em Configuracoes.

### Prototipo
Navegacao `NAVIGATE` (funciona apenas entre frames da mesma pagina no Figma):
- Toggle Quadro/Tabela/Calendario entre as visualizacoes; cards -> Detalhe; documentos -> Modal; "⚙ Atributos" -> Config; sidebars admin -> destinos corretos.
- Publico: Landing<->Login<->Planos<->Politicas, Recuperar Senha, 404.
- Cliente: Home -> menu bussola/dropdown -> secoes.
- Toggle de tema em todas as paginas L<->D.
- **Limitacao Figma:** links cross-page (Login -> Portal, em paginas diferentes) exigem copiar o frame; nao sao navegaveis entre paginas distintas.
