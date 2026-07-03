# Handoff — Build de Auth/Admin/Portal (retomar após reiniciar)

> **Estado salvo em 2026-07-03.** Branch: **`feat/auth-admin-portal`**. Plano aprovado: `~/.claude/plans/curried-drifting-shore.md`. Requisitos: `docs/REQUISITOS-PORTAL-NORTH.md`. Como subir: `docs/DEMO-LOCAL.md`.

## Onde paramos
Executando o plano "Portal North: Auth (Supabase) + Admin + Portal + Tasks + demo local".
Decisões do usuário: **Supabase Auth** · **incluir Kanban/Tasks** · **dev aponta p/ Supabase na nuvem** · **briefing por-pergunta**.

**Feito e compilando (`npm run build` verde, 6/6 rotas + middleware):**
- **Fase 1 — Fundações:** deps `@supabase/supabase-js`+`@supabase/ssr`; migrations `supabase/migrations/2026062312_base_schema`, `..0703000001_auth_profiles`, `..0703000002_rls_by_role`, `..0703000003_tasks`; `lib/supabase/{client,server,middleware,admin,auth}.ts`; `middleware.ts` (gate por role); `scripts/create-user.mjs`; `.env.example`; `seed.sql`.
- **Fase 2 — Auth + gating:** `app/login/page.tsx` (liquid glass, `signInWithPassword`), `app/logout/route.ts`; APIs protegidas por sessão (`requireClientAccess`/`requireAdmin` em `lib/supabase/auth.ts`) — fecha o gap de escrita pública do briefing.
- **Fase 3 — Portal + briefing por-pergunta:** `BriefingForm` com 1 campo por pergunta (chaves `${card.key}_q${n}`), logout no header; `PortalPremium.tsx` (legado) removido.

## BLOQUEIO para rodar o demo (retomar por aqui)
Não dá para *rodar/validar* sem as credenciais do Supabase na nuvem. Ao voltar:
1. Criar `.env.local` (raiz) com `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` do **projeto escolhido** (dúvida em aberto: README diz `svkogegypdqquzlfzaor`; memória diz projeto novo — confirmar qual).
2. Aplicar migrations na ordem (ver `docs/DEMO-LOCAL.md`) + rodar `supabase/seed.sql` (SQL Editor ou `npx supabase db push`).
3. Criar usuários: `npm run create:user -- admin@north.com "Senha!" admin` e `... cliente@karpinski.com "Senha!" client karpinski`.
4. Auth → adicionar `http://localhost:3000` nas Redirect URLs do Supabase.
5. `npm run dev` → `/login`. **Validar DEMO A/B:** login admin→`/admin`, cliente→`/karpinski`, briefing persiste, cliente não abre outro slug (RLS).

## Pendente (próximas fases)
- **Fase 4 — Admin CRUD UI:** `app/admin/*` (shell sidebar; Clientes/lista, Cadastro, Editar links/resultados/ativar) + API nova `GET/POST /api/admin/clients` (criar `clients`+3 filhos). *Obs.: `scripts/seed-client.mjs`/`update-client.mjs` viraram legado (API admin agora exige sessão, não `NORTH_ADMIN_TOKEN`).*
- **Fase 5 — Tasks/Kanban:** `/api/tasks` (CRUD) + board Quadro/Tabela/Calendário/Detalhe + modais (tabela `tasks` + RLS já existem na migration).
- **Fase 6 — Verificação + docs:** typecheck/lint/build; testar RLS/isolamento; deploy Vercel Preview; atualizar README/REQUISITOS/DUVIDAS.

## Notas técnicas
- Middleware é Edge (aviso `process.version` do supabase-js é o padrão do @supabase/ssr em middleware — funciona).
- Rotas de API deixaram de ser `runtime="edge"` (default Node) p/ cookies de auth estáveis.
- `handle_new_user` lê `role`/`client_id` de `app_metadata` do usuário (setados pelo `create-user.mjs`); middleware lê `role`/`client_slug` de `app_metadata`.
- CSS atual = **tema petróleo escuro** (globals.css), não o claro; login/portal seguem esse tema.

## Para retomar num chat novo
Ler: este handoff → `plans/curried-drifting-shore.md` → `docs/DEMO-LOCAL.md`. Estado no git: branch `feat/auth-admin-portal`, commit WIP "save state".
