# Handoff — Plataforma North (Portal do Cliente + Admin)

_Documento vivo. Atualizado em 2026-07-03. Branch `feat/auth-admin-portal`._

Plataforma B2B da North com **duas experiências**: o **Portal do Cliente** (editorial, bússola, tema claro+escuro) e o **Admin North** (operacional, sidebar, Kanban). Next.js 15 (App Router) + Supabase (Auth + Postgres com RLS por papel).

---

## 1. Como rodar

```bash
npm install
npm run dev          # http://localhost:3000  (porta padrão do Next)
npx tsc --noEmit     # checagem de tipos (fonte da verdade — ver §8)
```

- **Env**: `.env.local` (Supabase URL + anon/publishable + service_role). Template em `.env.example`.
- **Login admin**: `admin@north.com` / `SenhaForte123!`
- **Login cliente (demo)**: `cliente@karpinski.com` / `SenhaForte123!` (vê só o portal `karpinski`)
- ⚠️ **`localhost:3000` pode estar ocupado por OUTRA plataforma (Brain AI) na máquina do dev.** Se precisar, suba o North em outra porta: `PORT=3005 npm run dev`. Não confie em respostas da 3000 sem confirmar que é o North.
- ⚠️ Não rode `next build` com `next dev` ativo — corrompe `.next` (erro `/_not-found` + Internal Server Error). Pare o dev antes de buildar.

## 2. Arquitetura & Auth

- **Next 15 App Router.** Server Components buscam dados; Client Components para interação.
- **Supabase Auth** (cookies `@supabase/ssr`). O papel vem do `app_metadata.role` (`admin` | `client`) e, para clientes, `client_id`.
- **`middleware.ts`** faz o gate por rota (redireciona deslogado → `/login`; cliente que tenta `/admin` → bloqueado).
- **RLS é a camada de segurança real.** Todo acesso passa pelo client SSR autenticado (`lib/supabase/server.ts`) — **sem bypass service-role** nas rotas de request. Helpers no Postgres: `public.is_admin()` e `public.owns_client(client_id)`.
- Defesa em profundidade: `app/admin/layout.tsx` também checa `session.role === 'admin'`; APIs chamam `requireAdmin()` / `requireClientAccess()` (`lib/supabase/auth.ts`).
- **Projeto Supabase de produção**: ref `rqwycltgnnvaunvmyxea` (org `gptyqadndkqtryrggpgc`). NÃO é o `svkogegypdqquzlfzaor` citado em docs antigas.

### 2.1 Hierarquia de acesso — editor / revisor / admin (atual vs. pretendido)

O processo de revisão de tarefas (2026-07-05) introduziu os conceitos de **editor**, **revisor** e **cliente** ligados a uma tarefa. É importante deixar claro que hoje isso **não são níveis de permissão separados** — são só rótulos atribuíveis a um card, apontando para contas que já existem:

- **Hoje existem apenas 2 tipos de conta reais** (`profiles.role`): `admin` (compartilhado por toda a equipe North — um único login, ex.: `admin@north.com`) e `client` (um login por cliente, ex.: `cliente@karpinski.com`).
- **"Editor"** = quem está com a tarefa em `em_producao`/`backlog` — na prática, sempre a conta `admin` (não há distinção de qual pessoa da North editou; `assignee` é só um campo de texto livre, não uma conta).
- **"Revisor"** (`tasks.reviewer_id`, novo) = uma conta atribuível à tarefa antes de avançar para aprovação — pode ser a conta `admin` OU a própria conta do cliente dono da tarefa (nunca de outro cliente). O dropdown em `TaskModal`/`TaskDetailPanel` já filtra corretamente por isso (`listReviewerCandidates` em `lib/supabase.ts`).
- **"Cliente"** = a aprovação final, hoje só implícita — quando `client_visible=true` e `status='aprovacao'`, o card aparece no Plano de Ação do cliente (read-only, sem botão de "aprovar" do lado do cliente ainda — ver pendência #7 abaixo).
- O campo `reviewer_id` é simples e mutável (sem tabela de histórico) por decisão de produto — só interessa **quem está revisando agora**, não quem revisou antes.

**Modelo pretendido (backlog, não construído):** contas individuais por pessoa da North (não um `admin` compartilhado), com 3 níveis reais — Editor (cria/edita cards) < Revisor (aprova internamente, pode ser qualquer admin ou o próprio cliente) < Admin (acesso total, gerencia contas/config). Isso exigiria: login individual por colaborador North, um campo de permissão mais granular que o atual `role` binário, e uma tela de convite/gestão de equipe real (hoje só existe leitura via `listTeam()`).

## 3. Backend — migrations & tabelas

7 migrations em `supabase/migrations/`, **todas aplicadas** no projeto de prod:

| Migration | Conteúdo |
|---|---|
| `…000000_base_schema` / `init_client_portal_schema` | `clients`, `briefing_answers`, `client_drive_links`, `client_results` |
| `20260624…_harden_client_portal` | RLS/hardening do portal público original |
| `20260703000001_auth_profiles` | enum `user_role`, `profiles` (1:1 auth.users), trigger `handle_new_user`, `set_updated_at()` |
| `20260703000002_rls_by_role` | policies `is_admin()` / `owns_client()` em todas as tabelas |
| `20260703000003_tasks` | `tasks` (Kanban) + RLS (cliente vê só `client_visible`) |
| `20260703000004_client_content_and_prefs` | `client_content` (CMS jsonb) + `client_prefs` (tema/avatar/nome) |
| `20260703000005_documents` | **`documents`** (contratos/propostas/relatórios/materiais) — Aprovações/Documentos |
| `20260703000006_settings_and_legal` | **`legal_docs`** (Políticas, legível por todos) + **`site_settings`** (perfil da agência) |
| `20260705000001_task_reviewer` | `tasks.reviewer_id` (uuid → `profiles.id`, `on delete set null`) — sem tabela de histórico |

Tabelas (schema `public`, todas com RLS): `clients`, `profiles`, `briefing_answers`, `client_drive_links`, `client_results`, `tasks`, `client_content`, `client_prefs`, `documents`, `legal_docs`, `site_settings`.

## 4. Telas — Público (site institucional)

Referência Figma: arquivo **prod `I1nVg0mJH169Mv7IdVC67M`**, página **Público L↔D `365:4`**. Todo o site vive no route group **`app/(site)/`** com shell próprio `SiteFrame.tsx` (header sticky + nav + toggle claro/escuro + footer Produto/Empresa/Legal) e design system escopado em **`app/(site)/site.css`** (`.site`, tema via `[data-theme]`). Middleware libera essas rotas sem sessão.

| Rota | Arquivo | Figma | Status |
|---|---|---|---|
| `/` — Landing | `app/(site)/page.tsx` | `2004:137` | ✅ hero slider (3 slides) · Resultados · Cases (Baita dashboard + Prime agenda) · **Serviços (do catálogo)** · Depoimentos |
| `/planos` | `app/(site)/planos/page.tsx` | `411:438` | ✅ 3 tiers (Start/Growth/Custom) |
| `/como-funciona` | `app/(site)/como-funciona/page.tsx` | `411:970` | ✅ 4 etapas + banda "Filosofia North" |
| `/quem-somos` | `app/(site)/quem-somos/page.tsx` | `2031:2` | ✅ hero + valores + time + números |
| `/politica-de-privacidade` · `/termos-de-uso` · `/politica-de-cookies` | `app/(site)/**` + `LegalView.tsx` | `411:1308/1473` | ✅ **leem a tabela `legal_docs`** → editável em Configurações › Políticas |
| `/login` | `app/login/page.tsx` | `288:3` (liquid glass) | ✅ |
| `/recuperar-senha` | `app/recuperar-senha/page.tsx` | `411:1638/1695` | ✅ envia reset + estado de sucesso |
| `/logout` | `app/logout/route.ts` | — | ✅ encerra sessão |
| 404 | `app/not-found.tsx` | `411:1734` | ✅ branded |

Conteúdo dos serviços vem do catálogo **`#CATALOGO SERVIÇOS NORTH`** (4 categorias, 22 itens). Verificado a olho no Chrome (claro **e** escuro): Landing, Planos, Quem somos, Como funciona; Política lendo do banco.

## 5. Telas — Admin (`/admin/*`)

Shell em `app/admin/AdminShell.tsx` (sidebar 4 grupos, toggle de tema claro/escuro, painel de conta). Layout `app/admin/layout.tsx` gate por papel. Tema **claro "Névoa Sage"** + **escuro petróleo** (tokens `--a-*` em `globals.css`).

| Rota | Arquivo(s) | Figma | Status |
|---|---|---|---|
| `/admin` — Clientes | `page.tsx` + `ClientsTable.tsx` | `295:3` | ✅ lista + filtros |
| `/admin/novo` — Cadastro | `novo/page.tsx` | `297:2` | ✅ criar cliente |
| `/admin/[slug]` — Editor | `[slug]/page.tsx` + `ClientEditor.tsx` | — | ✅ links, métricas, insights, relatório, conteúdo JSON, ativar |
| `/admin/kanban` — Tarefas | `kanban/page.tsx` + `KanbanBoard.tsx` + `TaskDetailPanel.tsx` + `TaskModal.tsx` + `AttributesConfigModal.tsx` + `CalendarPicker.tsx` | `358:2/72`, `374:2`, `358:142`, `462:189/263/337/411`, `375:65` | ✅ **3 views** (Quadro/Tabela/Calendário) + filtros + CRUD + toggle "visível ao cliente"; clique no card abre **preview lateral** (Atributos quick-edit, Descrição, Atividade/comentários); ↗ expande p/ **modal central** com stepper de status + grade de campos específica por tipo (Criativo/Agendamento/Desempenho) + seletor de data via calendário popover; **⚙ Atributos** alterna visibilidade de campos ao vivo (persistido em `localStorage`) |
| `/admin/aprovacoes` — Aprovações | `aprovacoes/page.tsx` + `ApprovalsQueue.tsx` | `299:2` | ✅ fila cross-client (abas Aguardando cliente / Interno / Resolvidas); Aprovar/Ajustes/Reabrir/Lembrar |
| `/admin/documentos` — Documentos | `documentos/page.tsx` + `DocumentsTable.tsx` + `DocumentPreviewModal.tsx` | `311:2`, `375:2` | ✅ tabela + filtros + modal Enviar documento; **"Abrir" mostra preview** (mock do PDF + Detalhes + Baixar/Compartilhar/Aprovar documento) |
| `/admin/configuracoes` — Configurações | `configuracoes/page.tsx` + `SettingsPanel.tsx` | `299:133` | ✅ Perfil da agência · Equipe & papéis · **Políticas** (editar/publicar) · Aparência · (Faturamento/Integrações = em breve) |
| `/admin/onboarding` | `onboarding/page.tsx` | — (só item de nav no Figma) | ✅ overview: status de briefing por cliente |
| `/admin/performance` | `performance/page.tsx` | — | ✅ overview: métricas/relatório por cliente → editor |
| `/admin/plano` — Plano de Ação | `plano/page.tsx` | — | ✅ overview: nº de cards visíveis → Kanban |

**Kanban → Plano de Ação → Aprovações formam um ciclo**: um card `tasks` com `client_visible=true` aparece no Plano de Ação do cliente; nas etapas `aprovacao`/`concluido` aparece na fila de Aprovações. O Plano do cliente é **alimentado pelo Kanban** (fallback ao conteúdo estático quando não há tasks).

## 6. Telas — Portal do Cliente (`/[slug]`)

`app/[slug]/PortalPaged.tsx` (entrada `page.tsx`) + design system próprio **`app/[slug]/portal.css`** (escopado em `.np`, tema claro+escuro via `[data-theme]`). Conteúdo estático fiel ao Figma em `portalData.ts`, sobreponível por cliente via `client_content`. Referência Figma: **`269:2`** (claro) / espelho L↔D `365:3`.

Navegação = **bússola 2D** (header + dropdown mega-menu + overlay bússola full-screen com pontos cardeais N/L/S/O). 12 seções (`PageId`):

`inicio` (home: banner+bússola+hero+stats) · `jornada` (Central de pendências/Onboarding) · `briefing` (wizard por etapas, etapa 0 = "Pausa para o café", chaves `${card}_q${n}`) · `central` (Central Comercial) · `acessos` (Acessos & Pastas) · `feedbacks` (Entregas/Feedbacks) · `time-north` (Time North) · `documentos` · `agenda` (calendário mensal) · `dashboard` (barras + donut SVG) · `plano-acao` (**vem do Kanban**) · `config` (tema/avatar/nome — grava em `client_prefs`).

## 7. API (App Router)

**Cliente** (`requireClientAccess` — dono ou admin):
- `GET /api/client/[slug]` — payload do portal (briefing + links + results + content + prefs + plano)
- `PATCH /api/client/[slug]/briefing` — autosave das respostas
- `PATCH /api/client/[slug]/prefs` — tema/avatar/nome

**Admin** (`requireAdmin`):
- `GET/POST /api/admin/clients` · `PATCH /api/admin/client/[slug]` (bundle)
- `GET/POST /api/admin/tasks` · `PATCH/DELETE /api/admin/tasks/[id]`
- `GET /api/admin/approvals` (cross-client)
- `GET/POST /api/admin/documents` · `PATCH/DELETE /api/admin/documents/[id]`
- `GET /api/admin/legal` · `PATCH /api/admin/legal/[slug]`
- `GET/PATCH /api/admin/settings` (perfil da agência)

Camada de dados centralizada em `lib/supabase.ts`; validação Zod em `lib/validation.ts`; erros HTTP normalizados em `lib/api.ts`.

## 8. Verificação (o que foi conferido)

- `npx tsc --noEmit` **verde**.
- Rotas no servidor real (`localhost:3000` do North): `/login` → 200; todas `/admin/*` → 307 (gate); `/api/admin/*` → 401 deslogado.
- **Conferido a olho no Chrome, logado como admin (tema claro e escuro):**
  - Clientes (nav completa, 4 grupos) · Aprovações (aba Interno com card Karpinski + Ajustes/Aprovar) · Documentos (5 docs com badges de status corretos) · Configurações (Perfil + Políticas com 3 docs "Publicada" + Aparência) · Onboarding (status de briefing dos 3 clientes).
  - Kanban (Quadro/Tabela/Calendário) e Portal do cliente foram conferidos em sessões anteriores.
  - **2026-07-05**: drag-and-drop no Calendário (arrastar pill muda `due_date`, testado e persistido); sincronização de data card↔calendário; fluxo completo de revisor (dropdown filtrado admin+cliente do card → status `revisao` aparece em Aprovações "Em revisão" com nome do revisor → avançar para `aprovacao` cai certo em "Aguardando cliente"/"Interno" conforme `client_visible`); **propagação `client_visible=true` → Plano de Ação real do cliente testada de ponta a ponta** (task criada, marcada visível via API, conferida na página `/karpinski` de verdade, depois revertida); Kanban Quadro drag-and-drop entre colunas revalidado após o redesign de layout.

## 9. Pendências / próximos passos

- **FOUC de tema no admin**: o `AdminShell` inicia em `light` e restaura o tema do `localStorage` no `useEffect`, causando um flash na navegação full-page. Fix: injetar o tema antes da hidratação (script inline / cookie).
- **Público em código**: implementar as rotas Landing, Política de Privacidade, Termos, Cookies (backend `legal_docs` pronto).
- **Escritas do portal do cliente**: aprovar entregas/feedbacks, Agenda, Documentos (parte é read-only hoje). Em particular, o cliente ainda não tem um botão de "aprovar"/"pedir ajuste" no Plano de Ação — a aprovação hoje só é vista, nunca acionada, pelo lado do cliente.
- **Documentos**: upload real via Supabase Storage (hoje é link/URL, v1).
- **Notificações**: "Lembrar cliente" (Aprovações) e avisos de aprovação são TODO (hoje toast/no-op).
- **Equipe & papéis**: hoje lista `profiles` (read-only); criar/convidar usuário ainda é via `scripts/create-user.mjs`. Ver [[2.1 Hierarquia de acesso]] — contas individuais por colaborador North são backlog.
- **Kanban — vocabulário de estágios**: Figma tem 6 estágios (Entrada/Em planejamento/Em produção/Aprovação Interna/Aguardando Cliente/Concluído); código tem 5 (`task_status` enum). Migração de enum + UI, não feito.
- **Kanban — board cross-cliente**: Figma sugere um quadro único misturando clientes (4 chips de filtro iguais); código força um cliente por vez via `<select>`. Mudança de API maior, não feito.
- **Cards — riqueza visual**: Figma mostra subtítulo de categoria + badge de workflow secundário nos cards; precisaria de novos campos no `payload`. Não feito.
- Docs Fase 6: atualizar README / REQUISITOS / DUVIDAS.

## 10. Documentos relacionados

- `docs/PLANO-TELAS-ADMIN.md` — plano que originou as telas de Aprovações/Documentos/Configurações.
- `docs/DEMO-LOCAL.md` — passo-a-passo de subida.
- `docs/HANDOFF-AUTH-BUILD.md` — handoff da fundação de Auth.
- `docs/CURRENT_STATE_FIGMA_NORTH_ADMIN.md` — estado detalhado do Figma (sessões).
- `design_system.md` — manual da marca (tokens Névoa Sage claro/escuro).
