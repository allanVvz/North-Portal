# Cadastro Â· EdiÃ§Ã£o Â· Ver cliente Â· Home do Admin

## Contexto

Rodada anterior entregou 3 protÃ³tipos no Figma (Cadastro `297:2`, EdiÃ§Ã£o `2312:2`, Home `2306:554`). O usuÃ¡rio revisou e apontou problemas reais de design e de modelo. Esta rodada: **corrigir os 3 protÃ³tipos, criar a 4Âª tela ("Ver cliente" â€” dashboard do cliente para o admin), e sÃ³ entÃ£o implementar em cÃ³digo.**

O gap original continua valendo: o cadastro em cÃ³digo (`app/admin/novo/page.tsx`) tem 4 campos contra ~20 do Figma, e nÃ£o existe Home do admin. O que mudou nesta rodada Ã© o *nÃ­vel de ambiÃ§Ã£o*: as telas deixam de ser formulÃ¡rios e viram superfÃ­cies com dado real (preview de Instagram, preview de arquivos do Drive, correspondÃªncia visual do conteÃºdo do portal, captura automatizada de conversÃµes).

### DecisÃµes travadas com o usuÃ¡rio

1. **Google Drive = integraÃ§Ã£o real** via service account. Credenciais ainda nÃ£o existem â€” implementar com fallback gracioso.
2. **"+ Nova tarefa" na Home = atalho pro `TaskModal` existente** em `mode="new"`, nÃ£o formulÃ¡rio novo.
3. **NotificaÃ§Ãµes jÃ¡ existem** (`notifications`, `lib/notifications.ts`, API, realtime, sino no `AdminShell`) â€” reaproveitar.
4. **"Onboarding padrÃ£o" Ã‰ o briefing/questionÃ¡rio que jÃ¡ existe** (`briefing_answers` + `app/[slug]/content.ts`) â€” sem abstraÃ§Ã£o nova. Toggle sempre ligado/travado.
5. **"Enviar convite por e-mail" fica sÃ³ visual** â€” sem provider de e-mail nesta rodada.
6. **Escopo contratado = catÃ¡logo customizÃ¡vel** (tabela `scope_tags`, admin cria tag nova inline), nÃ£o enum em cÃ³digo.
7. **Checkpoints comerciais vivem dentro do cadastro/ediÃ§Ã£o**, reaproveitando `commercial_checkpoint_templates` (jÃ¡ existe e jÃ¡ Ã© seedada).
8. **VÃ­nculo de conta = ambos**: e-mail colaborador nas pastas do Drive + conta de anÃºncios Meta/Windsor (reaproveita o `accountMap` existente).
9. **Instagram = grid real via Windsor/Meta** â€” a integraÃ§Ã£o jÃ¡ puxa `instagram_organic` com mÃ­dia e permalink. Sem oEmbed.
10. **"Ver cliente" = dashboard do cliente para o admin** (read-only, com "Editar" levando Ã  tela de ediÃ§Ã£o).
11. **ConversÃµes = card de coleta**: card recorrente pede o nÃºmero ao cliente; a resposta alimenta a mÃ©trica automaticamente.
12. **Entrega da coleta = portal + notificaÃ§Ã£o** (infra que jÃ¡ existe, zero provider). E-mail/WhatsApp aparecem desabilitados com "configure em IntegraÃ§Ãµes".
13. **Cliente responde pelo card na Central de pendÃªncias do portal** (jÃ¡ tem login), nÃ£o por link pÃºblico tokenizado.

---

## CrÃ­tica das 3 telas (o que motivou esta rodada)

### Home `2306:554`
- **~40% da altura Ã© vazia** â€” as duas colunas esticam atÃ© 1024px sem conteÃºdo. O olho cai num vÃ£o morto.
- **KPIs sem contexto**: nÃºmero solto + label + bolinha. Sem tendÃªncia, sem comparativo com perÃ­odo anterior, sem sparkline. "4 em revisÃ£o" nÃ£o diz se Ã© bom ou ruim.
- **"Criar tarefa" ocupa um card inteiro para um botÃ£o** â€” desperdÃ­cio estrutural; Ã© uma aÃ§Ã£o de header.
- **A sidebar nÃ£o bate com a navegaÃ§Ã£o real do cÃ³digo.** O mock mostra `PROCESSOS / Documentos / Onboarding`; o real (`AdminShell.tsx:142-161`) Ã© `Clientes / Plano de AÃ§Ã£o / Tarefas / RevisÃµes / AprovaÃ§Ãµes` + `Performance / InformaÃ§Ãµes / AutomaÃ§Ãµes`. Pior: **"Clientes" aparece destacado numa tela que Ã© "InÃ­cio"**.
- **NotificaÃ§Ãµes sem tipo, sem Ã­cone, sem estado de nÃ£o-lida, sem aÃ§Ã£o** â€” sÃ³ texto e horÃ¡rio.
- Sem saudaÃ§Ã£o, sem recorte de perÃ­odo, sem hierarquia visual entre os blocos.

### Cadastro `297:2`
- **SemÃ¢ntica dos toggles invertida**: os checkpoints *obrigatÃ³rios* aparecem cinza/desligados e o *opcional* aparece verde/ligado. LÃª exatamente ao contrÃ¡rio da intenÃ§Ã£o.
- **Toggle Ã© o controle errado** para "quais checkpoints se aplicam" â€” o certo Ã© tag/chip selecionÃ¡vel (confirmado pelo usuÃ¡rio).
- **Aside "AO CRIAR" curto e ancorado no topo** â†’ ~1100px de coluna direita vazia enquanto o formulÃ¡rio desce.
- **Ordem ilÃ³gica**: "VÃ­nculo de conta" (que usa o e-mail do cliente) vem *antes* de "ResponsÃ¡vel & acesso" (onde o e-mail Ã© definido).
- **"Criar onboarding padrÃ£o (20 perguntas)" contradiz o prÃ³prio checklist** ("Onboarding = briefing do cliente") e o nÃºmero estÃ¡ errado: o briefing real tem 46 perguntas em 18 cards (`app/[slug]/content.ts`).
- Conta de anÃºncios sÃ³ tem placeholder â€” sem estado selecionado.

### EdiÃ§Ã£o `2312:2`
- **"Nome da empresa" duplicado** (card IdentificaÃ§Ã£o *e* card Dados da empresa). Bug.
- **2442px de scroll numa coluna Ãºnica estreita**, com ~1900px de coluna direita vazia. Um canvas de 1440px usado como se fosse mobile.
- Mesmo problema dos toggles de checkpoint.
- **"ConteÃºdo do portal (avanÃ§ado)" nÃ£o comunica nada** â€” lista os nomes das 9 seÃ§Ãµes e diz "JSON". O usuÃ¡rio estÃ¡ certo: precisa de correspondÃªncia visual real.
- **Materiais/Drive tem status textual mas nenhum preview de arquivo.**
- **MÃ©tricas sÃ£o label/value livres**, sem relaÃ§Ã£o com as mÃ©tricas reais da integraÃ§Ã£o.

### Bugs de modelo achados na investigaÃ§Ã£o (independentes do visual)
- **`content.documentos` Ã© campo morto**: estÃ¡ em `CONTENT_SECTIONS` (`ClientEditor.tsx:10-20`), Ã© gravado no banco, e **nunca Ã© lido por ninguÃ©m**. A pÃ¡gina Documentos do portal vem de `payload.documents`.
- **`content.trilhas` Ã© renderizado mas nÃ£o Ã© editÃ¡vel** â€” e como o save Ã© *replace total* do `client_content.data`, **qualquer save pelo ClientEditor destrÃ³i o override de `trilhas`**. Perda de dado silenciosa.
- **O merge Ã© shallow por seÃ§Ã£o** (`mergeContent`, `lib/supabase.ts:206-210`): salvar `home: {band:"x"}` apaga `banner`/`heroLead`/`stats` e quebra o portal em runtime. O editor visual **tem que sempre emitir a seÃ§Ã£o inteira**, partindo do default.
- **Sem validaÃ§Ã£o de shape no servidor** (`contentSchema = z.record(z.unknown())`, `lib/validation.ts:34-37`).
- **`LOCKED_IN_PROD = ["acessos","dashboard","time-north"]`** (`PortalPaged.tsx:104`) â€” o admin nÃ£o consegue nem ver 3 das seÃ§Ãµes que edita, em produÃ§Ã£o.

---

## Fase 0 â€” Figma (gate de aprovaÃ§Ã£o antes do cÃ³digo)

Arquivo prod `I1nVg0mJH169Mv7IdVC67M`, page Admin `295:2`.

**CorreÃ§Ã£o transversal nos 4 frames**: sidebar fiel Ã  nav real do cÃ³digo + item "InÃ­cio" no topo, com o item correto destacado por tela.

### 0.1 Cadastro `297:2`
- Checkpoints viram **chips selecionÃ¡veis** (nÃ£o toggles): obrigatÃ³rios em estado "sempre incluÃ­do" (chip sÃ³lido, sem âœ•), Kickoff como chip removÃ­vel/selecionÃ¡vel com rÃ³tulo "opcional".
- Aside "AO CRIAR" **sticky**, acompanhando o scroll.
- Reordenar: "ResponsÃ¡vel & acesso" **antes** de "VÃ­nculo de conta".
- Corrigir a copy do toggle de onboarding para bater com o checklist (sem "20 perguntas").
- Conta de anÃºncios com **estado selecionado**: `Baita Ads Â· â€¢â€¢â€¢â€¢4821` (final mascarado, como pedido).

### 0.2 EdiÃ§Ã£o `2312:2`
- Remover o "Nome da empresa" duplicado (fica sÃ³ em Dados da empresa).
- **Layout em 2 colunas** (ou abas) em vez de pilha Ãºnica de 2442px.
- Mesmos chips de checkpoint.
- **Materiais/Drive com preview real de arquivos** â€” grid de thumbnails por pasta (reaproveita o padrÃ£o visual de `app/GoogleDrivePreview.tsx`, que jÃ¡ existe).
- **"ConteÃºdo do portal" deixa de ser JSON** e vira editor visual por seÃ§Ã£o com miniatura do bloco correspondente do portal (ver Â§3.2).

### 0.3 Home `2306:554` â€” redesenho
- Matar o vÃ£o morto: densificar em grid real, altura proporcional ao conteÃºdo.
- KPIs com **comparativo de perÃ­odo e sparkline**.
- "+ Nova tarefa" como **aÃ§Ã£o do header**, nÃ£o card.
- NotificaÃ§Ãµes com **Ã­cone por tipo, estado de nÃ£o-lida e aÃ§Ã£o inline**.
- Adicionar bloco de agenda/prazos da semana para ocupar a coluna com informaÃ§Ã£o Ãºtil.

### 0.4 "Ver cliente" â€” NOVO frame
Dashboard do cliente para o admin, aplicando o skill `frontend-design` (jÃ¡ lido: hero como tese, tipografia com personalidade, estrutura que codifica informaÃ§Ã£o real, um elemento-assinatura). SeÃ§Ãµes:
- **Header**: nome, segmento, plano, status do contrato, botÃ£o "Editar cliente".
- **Assinatura da tela: preview do Instagram** â€” perfil (@handle, avatar, bio do cadastro) + **grid dos Ãºltimos posts reais** vindos de `instagram_organic` (Windsor/Meta), cada um com alcance/engajamento.
- **KPIs do cliente** (alcance, engajamento, investimento, conversÃµes) do perÃ­odo.
- **Pastas do Drive com preview de arquivos**.
- **Plano de aÃ§Ã£o / tarefas em andamento** + checkpoints comerciais como timeline.
- **Card de coleta de conversÃµes** (Â§5) com o Ãºltimo valor informado pelo cliente.

---

## Entrega 1 â€” Modelo de dados e cadastro

### 1.1 Migrations

`20260826000001_client_company_info.sql` â€” tabela 1:1 (padrÃ£o de `client_drive_links`/`client_results`):
`client_id uuid PK FK cascade, segmento text, cidade_uf text, instagram_ou_site text, updated_at` + trigger `set_updated_at` + RLS (admin all, cliente select via `owns_client`).

`20260826000002_client_contract.sql` â€” 1:1: `client_id PK, plano_tier text, escopo jsonb default '[]', valor_mensal numeric(12,2), contract_start date, responsavel_nome text, responsavel_whatsapp text, updated_at`. `escopo` Ã© jsonb (nÃ£o `text[]`) porque o chip "3 CarrossÃ©is" carrega quantidade.

`20260826000003_client_drive_folder_ids.sql` â€” `alter table client_drive_links add root_folder_id, brand_folder_id, products_folder_id, uploads_folder_id, drive_synced_at`. Os `*_url` existentes seguem sendo o link exibido; os IDs permitem re-sincronizar e listar arquivos.

`20260826000004_scope_tags.sql` â€” `id, key text unique, label text, has_quantity boolean, created_at` + RLS admin. Seed com as 6 tags atuais.

`20260826000005_checkpoint_templates_required.sql` â€” `alter table commercial_checkpoint_templates add required boolean not null default true` + `update ... set required=false where title='Kickoff e onboarding'`.

### 1.2 Zod (`lib/validation.ts`)
`PLANO_TIERS = ["start","growth","custom"]`; `scopeItemSchema {key, quantity?}`; `companyInfoSchema {segmento?, cidadeUf?, instagramOuSite?}`; `contractSchema {planoTier?, escopo?, valorMensal?, contractStart?, responsavelNome?, responsavelWhatsapp?}`. `adminCreateClientSchema` e `adminPatchSchema` ganham `companyInfo?`, `contract?`, `checkpointTemplateIds?: string[]`, `createDriveFolder?: boolean`, `adAccountId?: string`, `driveShareEmail?: string`.

### 1.3 Google Drive (`lib/googleDrive.ts`, novo â€” `npm install googleapis`)
- `isGoogleDriveConfigured()` â€” true sÃ³ com `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` parseÃ¡vel (`client_email`+`private_key`) e `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
- `provisionClientDriveFolders({slug, name, shareWithEmail?})` â†’ `null` se nÃ£o configurado (nunca lanÃ§a por isso). Cria pasta raiz + 3 subpastas (`mimeType: application/vnd.google-apps.folder`), e se `shareWithEmail` vier, `drive.permissions.create({role:'writer'})` best-effort.
- `listFolderFiles(folderId, limit)` â†’ `{id, name, mimeType, thumbnailLink, webViewLink}[]` â€” alimenta o preview de arquivos.

Plugado em `app/api/admin/clients/route.ts` **depois** de `createClientWithChildren`+`provisionClientAuth`, best-effort: falha nunca derruba a criaÃ§Ã£o do cliente. `.env.example` ganha as 2 vars comentadas como opcionais.

### 1.4 UI de cadastro
`app/admin/ClientFormSections.tsx` (novo) com seÃ§Ãµes props-driven, compartilhadas entre criar e editar: `CompanyInfoSection`, `PlanScopeSection` (pills + chips + "+ Nova tag" inline), `ResponsibleAccessSection`, `CheckpointsSection` (**chips, nÃ£o toggles**), `AdAccountLinkSection` (dropdown + final mascarado do ID quando selecionado), `DriveFoldersSection` (status + preview).

`app/admin/novo/page.tsx` vira Server Component fino (`requireAdmin()` + `isGoogleDriveConfigured()`) renderizando `app/admin/novo/NewClientForm.tsx`. Reaproveitar classes CSS jÃ¡ existentes (`admin-field`, `admin-card`, `admin-btn`); nunca usar seletor `select.classe` (gotcha de especificidade jÃ¡ documentado no projeto).

`lib/supabase.ts`: `AdminClientDetail` ganha `companyInfo`/`contract`; `getAdminClientDetail` busca as 2 tabelas novas no `Promise.all`; `createClientWithChildren` grava-as e chama `provisionKickoffTask`; `updateClientBundle` ganha os patches; novos `listScopeTags`/`createScopeTag`, `listCheckpointTemplates`, `saveDriveFolderProvisioning`. `provisionCheckpointsForClient(clientId, selectedIds?)` passa a respeitar a seleÃ§Ã£o (sempre incluindo os `required=true`).

Nova rota `app/api/admin/scope-tags/route.ts` (GET/POST, `requireAdmin`).

### 1.5 Card de kickoff no Kanban
`provisionKickoffTask(clientId)` em `lib/supabase.ts`, chamado de `createClientWithChildren` (mesmo ponto que jÃ¡ chama `provisionCheckpointsForClient`): insere task `kind='planejamento'`, `subtype='briefing'` (ambos jÃ¡ existem no catÃ¡logo), status `backlog`, `client_visible:false`.

---

## Entrega 2 â€” EdiÃ§Ã£o do cliente

`app/admin/ClientEditor.tsx` refatorado para usar `ClientFormSections.tsx` (elimina a divergÃªncia criar/editar) + layout em 2 colunas.

### 2.1 CorreÃ§Ãµes de bug obrigatÃ³rias
- Remover `documentos` de `CONTENT_SECTIONS` (campo morto) e **adicionar `trilhas`** (hoje renderizada e silenciosamente destruÃ­da a cada save).
- O save de conteÃºdo passa a partir de `defaultContent` e emitir a **seÃ§Ã£o inteira**, preservando chaves nÃ£o editadas â€” corrige a perda de dado.
- Adicionar validaÃ§Ã£o de shape por seÃ§Ã£o em `lib/validation.ts` (um schema Zod por seÃ§Ã£o do `PortalContent`), substituindo o `z.record(z.unknown())`.

### 2.2 "ConteÃºdo do portal" com correspondÃªncia visual real
Novo `app/admin/portalContent/` â€” um editor por seÃ§Ã£o, campo-a-campo, tipado a partir do shape real de `PortalContent` (`app/[slug]/portalData.ts:8-99`), com:
- Controles fechados onde o valor Ã© fechado: `tone` (5 valores), `acessos.folders[].key` (sÃ³ `brandUrl|productsUrl|uploadsUrl`), `page` (PageIds), `icon` (nomes do `<Ico>`), `trilhas.items[].type/status`, `agenda.calendar.startDow` (0-6).
- **Miniatura do bloco real do portal** ao lado de cada seÃ§Ã£o (reaproveitando os componentes de `PortalPaged.tsx` em modo preview), para o admin ver o que estÃ¡ editando.
- **Badge "fallback"** nos campos que sÃ£o sobrescritos por dados reais (`pendencias.total`, `home.stats`, `home.happening`, `central.checkpoints`, `agenda` inteira, `plano` inteiro, `dashboard.metrics`) â€” hoje o admin edita campos que nunca aparecem.

### 2.3 Materiais do Drive com preview
`DriveFoldersSection` chama `listFolderFiles` (via nova rota `app/api/admin/drive/files?folderId=`) e renderiza grid de thumbnails, reaproveitando o padrÃ£o de `app/GoogleDrivePreview.tsx`. Estado vazio e "nÃ£o conectado" tratados explicitamente.

---

## Entrega 3 â€” "Ver cliente" (`/admin/[slug]/visao`)

Nova rota read-only (`app/admin/[slug]/visao/page.tsx` + `ClientOverview.tsx`), aplicando `frontend-design`.

- **Instagram**: novo `app/admin/[slug]/visao/InstagramPanel.tsx` â€” perfil montado de `client_company_info.instagram_ou_site` + grid dos posts reais filtrados por `datasource='instagram_organic'` e pela conta mapeada do cliente, via a rota jÃ¡ existente `/api/admin/performance/insights?client={slug}`. Sem endpoint novo, sem oEmbed.
- **KPIs do perÃ­odo**: mesma rota de insights, agregada com os helpers puros jÃ¡ existentes (`sumMetric`/`aggregateMetric` em `app/admin/performance/insights.ts`).
- **Pastas com preview** (reusa Â§2.3), **plano/tarefas** (`listActionPlans`), **checkpoints** como timeline (`kind='checkpoint_comercial'`), **coleta de conversÃµes** (Â§5).
- BotÃµes "Editar cliente" â†’ `/admin/{slug}`, "Portal â†—" â†’ `/{slug}` (padrÃ£o jÃ¡ usado em `app/admin/[slug]/page.tsx:21-23`).

---

## Entrega 4 â€” Home do admin (`/admin/home`)

`middleware.ts:35` (`homeFor`) passa de `/admin/plano` para `/admin/home` â€” menor blast-radius que trocar a raiz (`/admin` continua sendo Clientes).

### 4.1 `listAdminHomeSummary()` em `lib/supabase.ts`
Combina fontes jÃ¡ existentes, sem tabela nova: `listAdminOverview()`, `listActionPlans()`, `listReviewQueue()`, `listApprovalQueue()` + 1 query leve de tasks vencidas.
```ts
type AdminHomeSummary = {
  clients: { total: number; active: number };
  overdueTasks: number; reviewQueueCount: number; approvalQueueCount: number;
  actionPlansInProgress: number; actionPlansAvgProgress: number;
  weekAhead: { taskId: string; title: string; clientName: string; dueDate: string }[];
  clientsNeedingAttention: { slug: string; name: string; reasons: string[] }[];
};
```
LÃ³gica pura em `lib/adminHome.ts` (sem `createClient`, testÃ¡vel sem Supabase â€” mesmo padrÃ£o de `lib/notifications.ts`): `deriveClientsNeedingAttention(rows)`, `averageProgress(plans)`.

### 4.2 Componentes
- `app/admin/home/page.tsx` (Server) + `AdminHome.tsx`.
- `app/admin/home/NewTaskLauncher.tsx` â€” abre `TaskModal` **diretamente** em `mode="new"`; `CardModalLauncher` sÃ³ suporta `mode="edit"` (`CardModalLauncher.tsx:137`), entÃ£o seguir o padrÃ£o de `ClientsWorkspace.tsx:372`.
- `app/admin/NotificationsPanel.tsx` â€” extrair o corpo do dropdown de `AdminShell.tsx:317-331` para um componente compartilhado (sino + versÃ£o expandida na Home), mesma API `GET /api/admin/notifications`.
- `AdminShell.tsx`: Ã­cone `home` em `ICON_PATHS` + item `{href:"/admin/home", ico:"home", label:"InÃ­cio"}` no topo de "OperaÃ§Ã£o". `isActive()`/`SECTION_HREFS` jÃ¡ generalizam.

---

## Entrega 5 â€” Card de coleta de conversÃµes

ConversÃµes da Meta sÃ£o esparsas e `paidOnly` (dependem de Pixel/CAPI do cliente) â€” por isso a coleta declarada pelo cliente. `task_metrics.source` jÃ¡ Ã© livre (`manual|windsor|meta`), entÃ£o `'cliente'` nÃ£o exige migration.

### 5.1 Backend
- `lib/automationCatalog.ts`: 3Âª entrada `coleta_metrica_cliente` ("Coleta de mÃ©tricas com o cliente"). O Ã­ndice Ãºnico em `automation_configs.target_task_id` continua vÃ¡lido (um card de coleta = uma automaÃ§Ã£o).
- Migration `20260826000006_metric_collection.sql`: `alter table automation_configs add collect_metric_keys text[]` (quais chaves de `METRIC_DEFS` esse card pede) + polÃ­tica RLS nova em `task_metrics` permitindo **UPDATE/INSERT do cliente** restrito a tasks com automaÃ§Ã£o de coleta ativa do prÃ³prio `client_id`.
- `lib/automations/run.ts`: o filtro hoje Ã© hardcoded `.eq("automation_key","relatorio_trafego_semanal")` (`:214-218`) â€” generalizar para ramificar por key. O tick diÃ¡rio e o `x-cron-secret` jÃ¡ existem, nenhum job novo.
- Ao vencer o `due_date`, a automaÃ§Ã£o: cria a notificaÃ§Ã£o (`lib/notifications.ts`, novo tipo `metric_collection_requested` em `NOTIFICATION_TYPES`) e marca o card como pendente de resposta. Canais e-mail/WhatsApp ficam **desabilitados na UI com "configure em IntegraÃ§Ãµes"** â€” mesmo padrÃ£o gracioso do Drive.

### 5.2 Portal do cliente
- `getPortalPayload` ganha `metricRequests` (tasks com coleta ativa e ainda sem resposta no perÃ­odo) â€” mesma query de tasks jÃ¡ existente, sem round-trip novo.
- `PendenciasPage` (`PortalPaged.tsx:1077`) ganha um grupo "Informe seus nÃºmeros" com os campos de `collect_metric_keys`.
- Nova rota `PATCH /api/client/[slug]/metrics/[taskId]` â†’ grava em `task_metrics` com `source='cliente'`.

### 5.3 Admin
Tela de AutomaÃ§Ãµes ganha o novo tipo no `<select>` jÃ¡ existente + seletor de quais mÃ©tricas coletar. A "Ver cliente" (Â§3) mostra o Ãºltimo valor informado e a data.

---

## Ordem de execuÃ§Ã£o

1. **Figma** (Â§0) â€” 4 telas, aprovaÃ§Ã£o do usuÃ¡rio. *Gate: nada de cÃ³digo antes disso.*
2. `npm install googleapis` + `lib/googleDrive.ts` + `.env.example`.
3. Migrations Â§1.1 + Â§5.1 â€” aplicar local antes de qualquer cÃ³digo que as referencie.
4. `lib/validation.ts` (schemas novos + schema por seÃ§Ã£o do portal, Â§2.1).
5. `lib/supabase.ts` (detail estendido, create/update, scope tags, checkpoints, drive provisioning, `listAdminHomeSummary`) + `lib/adminHome.ts`.
6. Rotas: `clients` (POST), `client/[slug]` (PATCH), `scope-tags`, `drive/files`, `client/[slug]/metrics/[taskId]`.
7. `ClientFormSections.tsx` â†’ `novo/NewClientForm.tsx` â†’ `ClientEditor.tsx` refatorado.
8. `app/admin/portalContent/` (editor visual, Â§2.2).
9. `app/admin/[slug]/visao/` ("Ver cliente", Â§3).
10. `NotificationsPanel.tsx` extraÃ­do â†’ `app/admin/home/` â†’ `AdminShell.tsx` + `middleware.ts`.
11. AutomaÃ§Ã£o de coleta (Â§5) â€” catÃ¡logo, `run.ts`, portal, tela de automaÃ§Ãµes.
12. Testes â†’ `npm run verify`.

## Testes

- **Vitest**: `lib/adminHome.test.ts` (`deriveClientsNeedingAttention`, `averageProgress`); schemas novos (caso feliz + rejeiÃ§Ã£o: `planoTier` invÃ¡lido, `quantity` negativa, seÃ§Ã£o de portal com shape errado); `lib/googleDrive.ts` sem env vars â†’ `isGoogleDriveConfigured()===false` e `provisionClientDriveFolders` retorna `null` sem lanÃ§ar (Ãºnico caminho testÃ¡vel em CI sem credenciais).
- **RegressÃ£o do bug de conteÃºdo**: teste garantindo que salvar uma seÃ§Ã£o **nÃ£o apaga** `trilhas` nem as demais chaves nÃ£o editadas.
- **Playwright**: `e2e/client-registration-v2.spec.ts` (cria cliente com todos os cards + chips de checkpoint + tag nova inline; confere `client_company_info`/`client_contract`/`scope_tags` e que sÃ³ os checkpoints escolhidos viraram tasks); `e2e/admin-home.spec.ts` (KPIs, `TaskModal` em modo criaÃ§Ã£o, painel de notificaÃ§Ãµes); `e2e/metric-collection.spec.ts` (automaÃ§Ã£o de coleta â†’ pendÃªncia no portal â†’ cliente responde â†’ `task_metrics` com `source='cliente'`).

## VerificaÃ§Ã£o end-to-end

- `npm run typecheck && npm test` a cada etapa; `npx playwright test` para os specs novos.
- VerificaÃ§Ã£o visual no Chrome logado como admin: criar cliente completo â†’ conferir persistÃªncia na ediÃ§Ã£o â†’ "Ver cliente" com grid do Instagram e preview do Drive â†’ `/admin/home` com KPIs reais â†’ responder uma coleta pelo portal do cliente e ver a mÃ©trica chegar.
- Parar o `next dev` antes de `next build`/typecheck (gotcha jÃ¡ documentado do projeto).

