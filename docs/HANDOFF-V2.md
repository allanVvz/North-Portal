# Handoff — North Portal v2

_Estado em 30/09/2026. Porta de entrada para quem vai refatorar o North Portal
num projeto novo, junto com o Brain e fora da Vercel. Este documento não repete
o que os outros já explicam: ele diz o que existe, onde está, o que ficou pela
metade e o que está amarrado à hospedagem atual._

## 1. Estado em 30/09

- **`main` = `44d5682`**. O typecheck, os 1407 testes e o build passam
  (`npm run verify`).
- **Produção fora do ar.** `northportal.vercel.app` responde `402
  DEPLOYMENT_DISABLED`, porque a conta Vercel foi suspensa por limite de uso do
  plano Hobby. O último deploy publicado foi `b81b526`. Os commits seguintes
  (`d0fdc1a`, `e8a7987`, `44d5682` e este) estão no `main`, mas nunca foram
  publicados.
- **O banco de produção continua no ar** (Supabase, ver §5). O agendamento
  diário continua disparando, mas o endereço que ele chama responde 402.
- **Três trabalhos ficaram pela metade**, cada um num branch próprio (§3).

## 2. O que ler, nesta ordem

| Arquivo | Para quê |
|---|---|
| `CLAUDE.md` | Comandos, armadilhas de CSS, hidratação e worktree, e estilo de commit. Curto e atual. |
| `docs/ARQUITETURA-TAREFAS.md` | Contrato canônico de cards, Entregas e workflows. |
| `docs/FLUXO-OPERACAO-NORTH.md` | Como a agência opera: plano → Entrega → etapas → revisão → aprovação. |
| `docs/REQUISITOS-PORTAL-NORTH.md` | Requisitos do portal do cliente e do admin. |
| `docs/northai/JORNADA-PONTA-A-PONTA.md` | Jornada da North AI (relatórios, interpretação de comentários). |
| `docs/operations/diarias-e-rotina-north.md` | Diárias de gravação e rotina de reuniões. |
| `docs/reporting/` e `docs/audits/` | Decisões dos relatórios (horário, formato) e auditorias com data. |
| `app/brand/README.md`, `app/avatar/README.md` | Donos únicos da marca e da foto de perfil. |
| `DEPLOY.md`, `docs/REPRODUCAO-DEPLOY.md` | Como o deploy funcionava. O segundo cita um project ref antigo do Supabase; o correto está no §5. |
| `docs/HANDOFF-PLATAFORMA-NORTH.md` | Handoff de julho. Útil para a origem das telas, mas parte está desatualizada. |

## 3. Branches

| Branch | Commit | Situação |
|---|---|---|
| `main` | `44d5682` + este | Código atual. |
| `wip/regras-automacao-v1` | `516249a` | **Não integrado.** Motor de regras globais de automação (`lib/automations/rules.ts`, `ruleEngine.ts`, rotas `automation-rules` e `tasks/[id]/automations`, `TaskAutomationPicker`, `GlobalAutomationSettings`), roteiros de diária por versão (`dailyScripts`, `dailyScriptMatch`), feedback interno e sugestão de modelo de performance. Feito sobre `87556cb`, 32 commits atrás do `main`, e conflita com ele em 26 arquivos. **A migração dele já roda em produção** e está no `main`: `20260927185112_automation_rules_v1`. |
| `feat/unified-card-review-v2` | `cb423b5` | **Topo não integrado.** A base (`ea60fe7`, `b81b526`: decisão de revisão atômica, histórico do card) está no `main`. O último commit é o trabalho parado de atribuição de revisor: `TaskReviewerPicker` com humano e "North AI revisora", e `deriveRequiresReview` considerando a IA. |
| `wip/decisao-por-botao` | `72e345f` | **Rascunho substituído.** Tem "quem move um card para Revisão vira revisor dele", pedido pela equipe e ainda ausente do `main`, e uma primeira fila de revisão. A fila que entrou é `lib/commentTargets.ts`. |
| `feat/comentarios-destino` | `44d5682` | Já está no `main`. |

## 4. Stack

- **Next.js 15.5.7** (App Router) e React 19.1. O app é um só: portal do
  cliente em `app/[slug]`, admin em `app/admin`, site público em
  `app/(site)`, 93 rotas em `app/api`.
- **Supabase**: Auth por link mágico e senha, Postgres com RLS em todas as
  tabelas de produto, cerca de 77 funções e gatilhos que guardam as regras de
  workflow, `pg_cron` com `pg_net` para o agendamento, e Vault para segredos.
- Relatórios em PDF com `@react-pdf/renderer`, gerados no servidor. Gráficos
  com `recharts`. Validação com `zod`.
- Testes: `vitest` (unidade, cerca de 150 arquivos) e `playwright` (e2e; parte
  deles abre dados reais de produção e não roda no CI).
- CI no GitHub (`.github/workflows/ci.yml`): `repo:check`, typecheck, testes e
  build em todo push e pull request.

## 5. Produção

- **Supabase**: project ref `rqwycltgnnvaunvmyxea`
  (`https://rqwycltgnnvaunvmyxea.supabase.co`). O `CLAUDE.md` cita uma memória
  `prod-supabase-project` que vive fora do repositório; o fato que importa é
  este. Documentos antigos citam outro ref.
- **Migrações**: `supabase/migrations/` é o histórico. Várias foram aplicadas
  direto pelo MCP (`apply_migration`), que grava a versão pelo relógio da
  aplicação. Em 30/09 os nomes dos arquivos foram alinhados às versões de
  produção. Algumas migrações têm `preflight/`, `postflight/`, `rollback/` e
  `ledger/` com o mesmo número.
- **Tabelas `*_archive_2026091x/2x`**: cópias de segurança de limpezas de dados
  feitas à mão. Sem RLS e sem uso pelo app. Não migrar como se fossem modelo.

## 6. Amarrado à Vercel e ao endereço atual

Para tirar o app da Vercel, estes pontos precisam mudar juntos:

1. **Agendamento diário.** O job `automations-run-daily` (`0 11 * * *` UTC =
   08:00 em São Paulo) faz `net.http_post` para
   `https://northportal.vercel.app/api/admin/automations/run`. O endereço está
   escrito no próprio comando; ver
   `supabase/migrations/20260921140000_cron_automacoes_canonico.sql` e
   recriar com o endereço novo. O segredo vai no cabeçalho `x-cron-secret`,
   lido do Vault (`automations_cron_secret`), e o app compara com a variável
   `CRON_SECRET`. A nota do `.env.example` sobre o GUC `app.cron_secret` é
   anterior ao Vault. O timeout é de 300 s, porque a rota gera relatórios.
2. **Login.** No Supabase Auth, o Site URL e as Redirect URLs do link mágico.
3. **Meta.** OAuth com redirect em
   `https://DOMÍNIO/api/admin/integrations/meta/callback` (`lib/meta.ts`).
4. **`NEXT_PUBLIC_SITE_URL`.**
5. **Trabalho longo.** A rota `app/api/admin/automations/run` gera relatório
   com Meta ou Windsor, PDF e IA, e passa de 5 s com folga.
   `app/api/admin/drive/maintenance` tem `maxDuration = 300`. A rota de
   comentários usa `after()` do `next/server` para interpretar pedidos e
   regerar relatórios depois de responder. Num servidor Node (`next start`)
   tudo isso funciona sem ajuste. Em funções com tempo curto, não.
6. **Middleware** (`middleware.ts`): roda no Edge na Vercel e funciona igual em
   Node.
7. `scripts/rerun-automations.mjs` usa `northportal.vercel.app` como padrão.
8. Não há `vercel.json` nem pacotes `@vercel/*`.
9. Links já compartilhados em comentários e notificações apontam para
   `northportal.vercel.app`.

## 7. Variáveis de ambiente (só os nomes)

- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. Só para a CLI: `SUPABASE_PROJECT_REF`,
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.
- **Site**: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GA4_ID`,
  `WHATSAPP_BUSINESS_NUMBER`.
- **Integrações**: `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`,
  `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
- **Agendamento**: `CRON_SECRET`.
- **Ajustes de IA (opcionais)**: `OPENAI_MODEL`, `OPENAI_INTERPRET_MODEL`,
  `NORTHAI_MODEL`, `NORTHAI_REPORT_PLANNER`, `DASHBOARD_ARCHITECT_MODEL`,
  `COMMENT_AI_FALLBACK`, `AI_CLI`.
- **Só em scripts e previews locais**: `PREVIEW_*`, `RUN_AUTOMATIONS`,
  `RUN_REGEN`, `RUN_AI_EVAL`, `DEMO_*`.
- **Chaves que ficam no banco, não no ambiente**: a chave da OpenAI, a da Meta
  e a da Windsor ficam em `integration_credentials` com o segredo no Vault.
  Elas são cadastradas em Configurações › Integrações; ver `lib/ai/provider.ts`
  e `lib/automations/serviceIntegrations.ts`.

## 8. Modelo de dados, em uma página

- **`tasks`** é a única tabela de cards. A classificação real é
  `task_type_id` (`task_types`); `kind` e `subtype` são projeções de leitura.
  O `payload` (jsonb) guarda os comentários (`payload.comments`), os revisores
  extras (`payload.reviewer_ids`), o formato da peça e o estado das automações.
- **`task_links`** liga cards:
  - `structural_member`: plano → membro;
  - `workflow_step`: Entrega → etapa. Traz `status_override` e
    `completed_at_override`, ou seja, o andamento **por Entrega**. Uma etapa
    compartilhada, como uma Edição usada no Reels e no Carrossel, tem um
    andamento em cada uma.
- **Workflows**: `workflow_versions` e `workflow_version_steps`. Gatilhos no
  banco garantem que:
  - o tipo de uma Entrega não muda depois de ativada;
  - as etapas são estritamente sequenciais;
  - o status do pai é projetado dos filhos (`reject_manual_rollup_status`);
  - vínculos estruturais não formam ciclo;
  - um card em Revisão só sai dela por `decide_task_review`.
- **Revisão**: `decide_task_review`, com idempotência por `request_id` e
  andamento por Entrega com `delivery_id`. Os eventos ficam em
  `task_activity_events`.
- **Relatórios**: `traffic_reports`, `conversion_reports`,
  `conversion_report_snapshots`, `report_attachment_replacements`, com o PDF
  em `documents`.
- **Drive**: `drive_creative_workspaces` (pastas Raw, Preview e Def; `multi_final`
  para carrossel e story), `drive_capture_workspaces`, `drive_assets`,
  `drive_final_versions`, `drive_raw_asset_links`, e as RPCs
  `register_drive_folder_asset` e `register_drive_raw_folder_asset`.
- **Automações**: `automation_configs` (as vigentes, presas ao card),
  `automation_runs`, e o esquema v1 de regras globais, que está vazio
  porque o código não foi integrado (§3).
- **Recorrência e rotina**: molde e ocorrências (`payload.recurrence_parent_id`),
  `routine_execution_links` e `materialize_recurring_daily`.
- **Clientes e acesso**: `clients` e as tabelas `client_*`, `profiles`,
  `task_assignees`, `responsibility_assignments`, `notifications`.

## 9. Regras que já custaram caro

Antes de reimplementar, leia o código e os testes destes módulos. Os
comentários explicam o bug real que motivou cada regra.

- **Onde um comentário é gravado**: `lib/flows/commentTarget.ts`. Comentar na
  Entrega grava na etapa corrente. O comentário nunca é duplicado em pai e
  filho, e um destino ambíguo é recusado com 409.
- **Para qual card vai o comentário e por qual endpoint**, e a fila de
  revisão: `lib/commentTargets.ts`.
- **O que aparece na conversa**: `lib/cardConversation.ts`. A marca
  `for_task_id` guarda o contexto de Entrega de uma etapa compartilhada.
- **Relatórios que leem comentários**: `lib/automations/conversionFlow.ts`.
  Um comentário num relatório é interpretado por IA como pedido de correção.
- **Drive**: `lib/creativeDrive.ts`, `lib/creativeDriveSync.ts` e
  `lib/driveMaintenance.ts`, que reatacha pastas e manda à lixeira as
  sobras que a automação criou.
- **Status e avanço**: `lib/flows/advance.ts`, `approve.ts`, `parentStatus.ts`
  e `currentStep.ts`.
- **CSS e hidratação**: `CLAUDE.md`, seções "CSS gotchas" e "Hydration
  gotcha".

## 10. Pendências abertas

1. Produção fora do ar (§1).
2. Regras de automação v1: o esquema está em produção e o código não (§3).
3. Atribuição de revisor com a North AI: parada no branch (§3).
4. "Quem move para Revisão vira revisor", pedido pela equipe, não está no
   `main`. Hoje o `main` também impede mudar à mão o status de um card em
   Revisão; só a decisão do revisor muda. Rascunho em `wip/decisao-por-botao`.
5. Duas perguntas de dados sem resposta da equipe:
   - "Divulgação Evento" e "Dicas" estão em Revisão sem arquivos. Voltam para
     Em produção?
   - Quando um final volta para Preview, o comentário "Arquivo final" deve ser
     reescrito?
6. O `TaskModal.tsx` ainda tem cerca de 2300 linhas. A preferência da equipe
   é extrair em arquivos próprios, como já foi feito com a coluna de
   comentários (`TaskCommentsBox`, `TaskCommentThread`).
7. Cada modal de card aberto consulta os materiais do Drive a cada 60 s
   (`app/admin/useTaskMaterials.ts`). Em hospedagem cobrada por chamada, isso
   pesa.

## 11. Como a equipe trabalha

- Commits em português: `tipo(escopo): resumo`, com um corpo que explica o
  **porquê**, citando o caso real que motivou a mudança.
- Mudança de interface é mínima e preserva o que a equipe já usa. Antes de
  publicar, mostre capturas da tela.
- **O repositório é público.** Nada de capturas, dados de cliente ou segredos
  no Git. `artifacts/` e `.env*` estão no `.gitignore`.
