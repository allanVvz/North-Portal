# Requisitos — Portal North (DEFINITIVO)

> **Versão:** 2.0 · **Data:** 2026-07-02 · **Autor:** Engenharia (backend sênior)
> **Status:** documento vivo e definitivo. Substitui `REGRAS-DE-NEGOCIO-PORTAL-NORTH.deprecated.md`.
> **Escopo:** aplicação real neste repositório (Next.js 15 + Supabase REST + Vercel Edge). Não descreve o protótipo Figma (ver `docs/CURRENT_STATE_FIGMA_NORTH_ADMIN.md`).

Este documento é a fonte única de verdade para o backend/infra do Portal North. Ele mapeia o repositório, o modelo de dados, todos os fluxos e requisições, a estratégia de custo no **Supabase free tier**, o caminho de **escala futura em Docker** sem reescrever, e as **divergências conhecidas**. Perguntas ainda abertas ficam em `docs/DUVIDAS-PRE-DEPLOY.md`.

---

## 1. Visão geral

O Portal North é uma aplicação web **multi-cliente por `slug`**. Cada cliente tem uma URL pública (`/[slug]`) que carrega briefing, materiais (links de Drive) e resultados (métricas/insights/relatório/feedback). A escrita administrativa é feita por uma rota protegida por token; o cliente edita apenas o próprio briefing.

**Princípios:**
- Sem backend tradicional/VPS hoje: **serverless (Vercel Edge) + PostgREST (Supabase)**.
- O **`slug`** é a referência pública; o **UUID** é a referência interna. O navegador nunca escolhe registro por `client_id`.
- Dados isolados por cliente. Um slug nunca lê/escreve dados de outro.
- **Econômico primeiro**: minimizar requisições ao Supabase e manter tudo dentro do free tier, com um caminho claro para self-host em Docker quando escalar.

### 1.1 Stack atual (verificada no código)

| Camada | Tecnologia | Observação |
|---|---|---|
| Framework | Next.js `15.5.7` (App Router) | `app/` |
| Runtime das APIs | **Edge** (`export const runtime = "edge"`) | as 3 rotas |
| UI | React `19.1.2`, CSS global | `app/globals.css` (1488 linhas) |
| Validação | Zod `3.24.4` | `lib/validation.ts` |
| Dados | **Supabase via REST/PostgREST** (`fetch`), service-role no servidor | `lib/supabase.ts` — **não usa `@supabase/supabase-js`** |
| Hospedagem | Vercel (`north-portal`) | domínio atual `north-portal-navy.vercel.app` |
| Banco | Supabase Postgres + RLS | migration `supabase/migrations/20260624000000_harden_client_portal.sql` |

---

## 2. Mapeamento do repositório

### 2.1 Essenciais (núcleo da aplicação — **não remover**)

| Caminho | Papel |
|---|---|
| `app/layout.tsx` | Root layout, `<html lang="pt-BR">`, metadata. |
| `app/page.tsx` | Rota `/` → `redirect('/north')`. |
| `app/[slug]/page.tsx` | Entrada do portal — **re-exporta `PortalPaged`**. |
| `app/[slug]/PortalPaged.tsx` | **Componente de portal ATIVO** (794 linhas): fetch, autosave, navegação bússola. |
| `app/[slug]/content.ts` | Conteúdo estático (12 seções de briefing `briefSteps`, manual, pastas). **Fonte das perguntas.** |
| `app/api/client/[slug]/route.ts` | `GET` payload do portal. |
| `app/api/client/[slug]/briefing/route.ts` | `PATCH` do briefing (⚠️ sem auth — ver §7). |
| `app/api/admin/client/[slug]/route.ts` | `PATCH` administrativo (Bearer token). |
| `lib/supabase.ts` | Acesso a dados (REST, service role) + `getPortalPayload`, `saveBriefing`. |
| `lib/validation.ts` | Zod schemas, `HttpError`, normalizadores, limites de tamanho. |
| `lib/api.ts` | `apiError`, `safeTokenEquals` (comparação de token em tempo ~constante). |
| `app/globals.css` | Design system aplicado (paleta, tipografia). |
| `supabase/migrations/20260624000000_harden_client_portal.sql` | RLS + índices únicos. |
| `package.json`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts` | Build/config. |
| `.env.example` | Contrato de variáveis de ambiente. |

### 2.2 Úteis (suporte/ops/docs — manter)

| Caminho | Papel |
|---|---|
| `README.md` | Onboarding do repo, URLs, rotas, env. **Precisa de atualização** (ver §11). |
| `ADMIN.md` | Exemplo de `curl` administrativo. |
| `scripts/seed-client.mjs` | Cria/ativa cliente via rota admin. |
| `scripts/update-client.mjs` | Atualiza cliente via rota admin (JSON arbitrário). |
| `docs/REQUISITOS-PORTAL-NORTH.md` | **Este documento.** |
| `docs/DUVIDAS-PRE-DEPLOY.md` | Perguntas técnicas pré-deploy. |
| `docs/CLIENTES-E-DEMONSTRACAO.md` | Tipos de cliente + dados de demo. |
| `docs/CURRENT_STATE_FIGMA_NORTH_ADMIN.md` | Estado do protótipo Figma (design, não código). |
| `design_system.md` | Manual de marca. |

### 2.3 Legado / a decidir (não faz parte do runtime)

| Caminho | Situação | Recomendação |
|---|---|---|
| `app/[slug]/PortalPremium.tsx` | **Componente alternativo NÃO importado** (746 linhas). | Legado. Manter só se for a próxima direção de UI; senão **remover** para reduzir ruído/bundle mental. |
| `DOCUMENTACAO-SIDEBAR-BUSSOLA.md` | Doc de UI da bússola. | Mesclar em `design_system.md` ou mover para `docs/`. |
| `Guia-stories.html` | Fonte do deck de stories (design). | Não é app. Mover para `docs/assets/` ou `design/`. |
| `memory.md` | Arquivo de agente (git-ignored). | Ignorar; não versionar. |

### 2.4 Descartáveis / não versionar (ruído no diretório de trabalho)

Já cobertos por `.gitignore` (verificado). **Não devem ir para o git:**
`node_modules/`, `.next/`, `.npm-cache/` (cache local grande), `.vercel/`, `*.tsbuildinfo`, `*.log`, `.claude/`, `.git-alt/` (diretório git perdido/duplicado — **investigar e remover se órfão**), `.codex-run/`, `.env`, `.env*.local`.

> **Ação de higiene:** confirmar que `.git-alt/` e `.npm-cache/` não estão sendo commitados (estão no `.gitignore`) e apagá-los do working tree se forem lixo. Apenas **25 arquivos** estão de fato versionados hoje.

---

## 3. Arquitetura & topologia de requisições

```
Navegador (cliente)
   │  1) GET /[slug]              (HTML/JS — Next SSR/edge)
   │  2) GET /api/client/[slug]   (client-side fetch em useEffect)
   │  3) PATCH /api/client/[slug]/briefing  (autosave, debounce)
   ▼
Vercel Edge Functions (Next Route Handlers, runtime="edge")
   │  service-role key (server-only)
   ▼
Supabase PostgREST  (/rest/v1/…, Prefer: return=representation, cache: no-store)
   ▼
Postgres + RLS
```

**Observações de arquitetura relevantes para custo/escala:**
- Não há conexão Postgres direta (sem pool/pgbouncer): tudo é **HTTP stateless via PostgREST** → ideal para serverless e free tier (sem esgotar conexões).
- O portal busca dados **no cliente** (`fetch` em `useEffect`), não no servidor. Cada visita = 1 request à Edge Function + as queries REST correspondentes.
- `GET /api/client/[slug]` dispara **4 queries REST**: 1 `clients` + (em paralelo) `briefing_answers`, `client_drive_links`, `client_results`.

---

## 4. Modelo de dados

Quatro tabelas, relação 1‑para‑1 a partir de `clients` (um registro filho por cliente).

```
clients (1) ──┬── (1) briefing_answers
              ├── (1) client_drive_links
              └── (1) client_results
```

### 4.1 `clients`
| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | interna |
| `slug` | text | único, `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `name` | text | nome exibido |
| `is_active` | boolean | gate de acesso ao portal |
| `created_at` / `updated_at` | timestamptz | automáticos |

### 4.2 `briefing_answers`
| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid FK | **único por cliente** |
| `answers` | jsonb | estado atual (sem versionamento/histórico) |
| `submitted` | boolean | conclusão |
| `updated_at` | timestamptz | |

- **Chaves das respostas = chaves estáveis por card temático** (`b1_historia`, `b1_quem`, `b2_metas`, …), definidas em `app/[slug]/content.ts` (`briefSteps`). O texto da pergunta nunca é identificador. Ver §11 (divergência design ↔ código sobre "uma caixa por pergunta").
- Limites: `answers` ≤ **50 000 bytes** (`MAX_ANSWERS_BYTES`), campo de texto ≤ **5 000 bytes**.

### 4.3 `client_drive_links`
| Campo | Tipo | Semântica |
|---|---|---|
| `brand_url` | text | Materiais da marca |
| `products_url` | text | Produtos & ofertas |
| `uploads_url` | text | Enviar arquivos |

Regras: só admin cadastra; vazios ocultam/desabilitam o botão; abrir em nova aba com `rel="noopener noreferrer"`; **exigir HTTPS** (validar no admin — hoje só valida tamanho ≤ 5000, ver §7).

### 4.4 `client_results`
| Campo | Tipo | Semântica |
|---|---|---|
| `insights` | jsonb | lista `{title, description, category?, date?}` |
| `top_metrics` | jsonb | **≤ 4** `{label, value, variation?, description?}` |
| `report_url` | text | Relatório completo |
| `feedback_url` | text | Formulário de feedback |

### 4.5 Segurança de dados (RLS — estado atual)
A migration habilita RLS nas 4 tabelas e cria **apenas políticas de SELECT** para `anon, authenticated`, restritas a clientes ativos. **Não há política de INSERT/UPDATE/DELETE para `anon`** → toda escrita depende da **service-role key** (que ignora RLS) usada nas Edge Functions. Índices únicos garantem 1 registro filho por cliente.

> **Consequência importante:** a proteção de escrita **não está no banco** (RLS), e sim na aplicação. Logo, **quem chama as rotas de escrita precisa ser autenticado na camada de aplicação** — e hoje o briefing não é (ver §7).

### 4.6 DDL de referência (para recriar o schema em novo projeto/Docker)
> As tabelas foram criadas antes da migration (a migration só endurece). Este DDL reconstrói tudo do zero (útil para o projeto prod novo e para Postgres em Docker):

```sql
create extension if not exists "pgcrypto";

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clients_slug_unique_idx on public.clients (slug);

create table public.briefing_answers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  submitted boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index briefing_answers_client_id_unique_idx on public.briefing_answers (client_id);

create table public.client_drive_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  brand_url text, products_url text, uploads_url text,
  updated_at timestamptz not null default now()
);
create unique index client_drive_links_client_id_unique_idx on public.client_drive_links (client_id);

create table public.client_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  insights jsonb not null default '[]'::jsonb,
  top_metrics jsonb not null default '[]'::jsonb,
  report_url text, feedback_url text,
  updated_at timestamptz not null default now()
);
create unique index client_results_client_id_unique_idx on public.client_results (client_id);

-- depois aplicar a migration de RLS (20260624000000_harden_client_portal.sql)
```

---

## 5. Fluxos completos

### 5.1 Carregar portal `/[slug]`
1. Navegador abre `/[slug]` → Next entrega a página.
2. `PortalPaged` faz `fetch('/api/client/{slug}')` no `useEffect`.
3. Edge: `validateSlug` → `getPortalPayload(slug)`:
   - `getClient(slug)` (`is_active=eq.true`, `limit=1`). Se vazio → **404**.
   - 3 queries em paralelo (briefing/links/results por `client_id`).
   - Normaliza nulos (`normalizeInsights`, `normalizeMetrics`).
4. Retorna JSON (contrato em §6.1). Front hidrata `answers`, chip de status.

**Erros:** slug inválido → 400; inexistente/inativo → 404; sem env/Supabase indisponível → **503**.

### 5.2 Autosave do briefing
- Front observa `answers`; em mudança, agenda `setTimeout` (debounce) e faz `PATCH /api/client/{slug}/briefing` com `{answers, submitted}`.
- Edge: `getClient(slug)` → `saveBriefing(client.id, answers, submitted)` (PATCH REST em `briefing_answers`, seta `updated_at`).
- Retorna estado salvo `{answers, submitted, updatedAt}`; front atualiza chip (`Salvo`/`Concluido`).
- Requisitos: debounce 800–1200 ms; não enviar por tecla; "última edição válida prevalece"; ignorar respostas atrasadas (race). Sem versionamento/histórico.

### 5.3 Concluir briefing
- Front faz `PATCH …/briefing` com `submitted: true` (respostas permanecem editáveis). Não duplica registro.

### 5.4 Atualização administrativa `PATCH /api/admin/client/[slug]`
1. Header `Authorization: Bearer <NORTH_ADMIN_TOKEN>`; comparação por `safeTokenEquals`. Ausente/inválido → **401**.
2. `getClient(slug, includeInactive=true)`. Inexistente → 404.
3. Aplica **patches parciais** em `clients` (name/is_active), `client_drive_links` (3 urls), `client_results` (insights/top_metrics/report/feedback). Cada bloco só é escrito se veio no payload. `updated_at` atualizado.
4. Retorna `{ok:true}`.

### 5.5 Cadastro de novo cliente
> **Gap operacional:** hoje **não há endpoint de criação (`POST`)**. `scripts/seed-client.mjs` faz um `PATCH` admin que assume que o cliente **já existe** no banco. O fluxo "criar clients + 3 filhos vazios" precisa ser feito **manualmente no Supabase** (SQL/Studio) ou por um endpoint novo. Ver §11 e Dúvidas.

Fluxo desejado: definir name+slug → inserir `clients` → inserir os 3 filhos vazios → preencher via admin → `is_active=true`.

### 5.6 Troca de slug / desativação / exclusão
- Slug muda a URL pública; dados permanecem por `client_id`; validar conflito de slug; considerar redirect da URL antiga.
- Desativar: `is_active=false` (portal fecha, dados preservados).
- Excluir: ação explícita; `ON DELETE CASCADE` remove filhos.

---

## 6. Contratos de API

### 6.1 `GET /api/client/[slug]` → 200
```json
{
  "client": { "slug": "north", "name": "ADM NORTH" },
  "briefing": { "answers": {}, "submitted": false, "updatedAt": null },
  "driveLinks": { "brandUrl": null, "productsUrl": null, "uploadsUrl": null },
  "results": { "insights": [], "topMetrics": [], "reportUrl": null, "feedbackUrl": null }
}
```
Status: 400 (slug inválido) · 404 (inexistente/inativo) · 503 (env ausente / Supabase off).

### 6.2 `PATCH /api/client/[slug]/briefing`
Body: `{ "answers": { "<card_key>": "texto" }, "submitted": false }` → 200 `{answers, submitted, updatedAt}`.
Limites: answers ≤ 50 KB. **Sem autenticação hoje (ver §7).**

### 6.3 `PATCH /api/admin/client/[slug]`
Header: `Authorization: Bearer <token>`. Body (todos opcionais): `name, is_active, brandUrl, productsUrl, uploadsUrl, insights[], topMetrics[≤4], reportUrl, feedbackUrl` → 200 `{ok:true}`. 401/404/400 conforme §5.4.

---

## 7. Segurança

### 7.1 O que já está correto
- `SUPABASE_SERVICE_ROLE_KEY` só no servidor (Edge), nunca no bundle.
- RLS habilitada; leitura pública só de clientes ativos; sem escrita anônima no banco.
- Admin protegido por token com comparação em tempo ~constante (`safeTokenEquals`).
- Zod valida payloads; limites de tamanho (50 KB / 5 KB); erros genéricos ao cliente (sem stack trace).

### 7.2 GAPS a resolver antes do deploy
1. **🔴 `PATCH /api/client/[slug]/briefing` é público.** Qualquer pessoa que descubra um slug ativo pode **sobrescrever o briefing** daquele cliente (dentro dos limites de tamanho). Não há login de cliente. **Decidir mitigação** (ver Dúvidas): (a) token/senha por cliente; (b) link mágico/PIN; (c) aceitar risco em MVP com slugs não-adivinháveis + rate limit + auditoria. Como não há histórico, uma sobrescrita maliciosa é destrutiva.
2. **🟠 URLs não validadas como HTTPS.** `asStringOrNull` só checa tamanho. O admin pode gravar `javascript:` ou `http://`. **Validar esquema HTTPS** no schema Zod (`z.string().url()` + checagem de protocolo).
3. **🟠 Sem rate limiting.** Edge Functions abertas → abuso pode consumir cota do Supabase/Vercel. Adicionar rate limit por IP/slug (ex.: Upstash Ratelimit no free tier, ou limite simples em memória por instância).
4. **🟡 CORS/headers.** Definir headers de segurança (CSP básica, `X-Content-Type-Options`, etc.) — hoje ausentes.
5. **🟡 Rotação de segredos.** `NORTH_ADMIN_TOKEN` é um segredo único compartilhado; sem expiração. Documentar rotação.

---

## 8. Supabase free tier — orçamento e estratégia econômica

**Limites relevantes do free tier (ordem de grandeza; confirmar no painel — cotas mudam):**
- Projeto **pausa após ~7 dias de inatividade** (crítico para demo/baixo tráfego — ver Dúvidas).
- ~500 MB de banco, ~5 GB egress/mês, limite de requisições da API generoso mas finito, 2 projetos ativos por org no plano free.
- Sem custo por conexão (usamos PostgREST/HTTP, não conexões diretas) → **não há risco de esgotar pool**.

**Orçamento de requisições por interação:**
| Interação | Queries Supabase |
|---|---|
| Abrir `/[slug]` | 4 (1 client + 3 filhos) |
| Cada autosave | 2 (1 client lookup + 1 PATCH) |
| Concluir briefing | 2 |
| Admin update | 1 lookup + até 3 PATCH |

**Estratégias para ficar barato (recomendações):**
1. **Reduzir o lookup redundante de cliente na escrita.** Hoje `saveBriefing` faz `getClient` **e** o handler já fez `getClient` (2 lookups por autosave). Consolidar em 1. Melhor ainda: resolver `client_id` uma vez no load e assinar num cookie/token curto para evitar lookup a cada PATCH (com cuidado de segurança).
2. **Colapsar o payload em 1 query.** Trocar as 3 queries por uma **RPC/`view`** ou um `select` com *embeds* PostgREST (`clients?select=...,briefing_answers(...),client_drive_links(...),client_results(...)`) → **1 request em vez de 4** por load. Grande economia e menos latência.
3. **Debounce agressivo + coalescing** no autosave (já previsto 800–1200 ms); só enviar em `blur`/mudança real; cancelar in-flight.
4. **Cache de leitura curto** para links/results (mudam raramente) via `revalidate` no Next; briefing sempre `no-store`.
5. **Keep-alive contra pausa do free tier:** um cron leve (Vercel Cron / GitHub Action) que faz `GET /api/client/north` 1×/dia evita a pausa por inatividade — **desde que aceitável pela política do plano** (ver Dúvidas).
6. **Egress:** payloads são pequenos (JSON), sem imagens no banco (Drive externo) → egress baixo por design. Manter assim.

---

## 9. Escala futura (Docker/self-host) sem reescrever

O design atual **já favorece a portabilidade** porque o acesso a dados é HTTP/PostgREST e a lógica está em Route Handlers. Caminho recomendado quando o free tier apertar:

1. **Fase 0 (hoje):** Vercel + Supabase free. Nenhum servidor.
2. **Fase 1 (escala barata):** manter Vercel; subir Supabase para Pro **ou** trocar o backend de dados por um **Postgres em Docker + PostgREST em Docker** (mesmo contrato REST → `lib/supabase.ts` só muda a env `NEXT_PUBLIC_SUPABASE_URL`/chave). Custo previsível.
3. **Fase 2 (self-host total):** empacotar o Next em Docker (`next start`, remover `runtime="edge"` → Node runtime), orquestrar `web + postgres + postgrest` com `docker-compose`; reverse proxy (Caddy/Traefik) com TLS. Backups `pg_dump` agendados.

**Pré-requisitos técnicos para não travar a migração:**
- Manter **toda** a lógica de dados em `lib/*` (já está) — nenhuma query espalhada em componentes.
- Evitar APIs exclusivas da Vercel Edge; se migrar para Node, revisar `runtime="edge"` (Web Crypto em `safeTokenEquals` funciona em Node 20+ também).
- Versionar **todo** o schema em `supabase/migrations/` (incluir o DDL da §4.6 como migration base) para recriar o banco em qualquer Postgres.
- Externalizar segredos (env), nunca no código.

---

## 10. Observabilidade, cache e performance

- **Logs:** `console.error` em `supabaseRest` e `apiError` (sem segredos). Em prod, ligar os logs da Vercel + alertas do Supabase.
- **Cache:** APIs de escrita `no-store` (já). GET do portal pode ganhar `revalidate` curto para links/results.
- **Performance:** payload pequeno; 3 queries paralelas. A consolidação em 1 query (§8.2) reduz latência de ~3 RTT para 1.

---

## 11. Divergências conhecidas (design ↔ código ↔ docs)

| # | Divergência | Impacto | Ação sugerida |
|---|---|---|---|
| 1 | **Briefing "uma caixa por pergunta"** (redesign Figma sessão 17) vs **1 resposta por card** (`briefing_answers.answers` keyed por `b1_historia`…). | O design implica respostas por pergunta; o modelo guarda por card. | Decidir: manter por-card (design é só visual) **ou** migrar para chave por pergunta (`b1_historia_q1`…) — impacta `content.ts`, front e formato do JSON. |
| 2 | **Projeto Supabase de produção.** README/`.env.example` apontam `svkogegypdqquzlfzaor`, mas há registro de que **prod usa um projeto NOVO**. | Deploy pode ir para o banco errado. | Confirmar o project ref/URL/keys corretos e atualizar README + env (ver Dúvidas). |
| 3 | **`PortalPremium.tsx` não usado.** | Código morto. | Remover ou promover conscientemente. |
| 4 | **Sem endpoint de criação de cliente.** `seed-client.mjs` só faz PATCH (assume cliente existente). | Cadastro real é manual no banco. | Criar `POST /api/admin/client` que insere `clients` + 3 filhos. |
| 5 | **Escrita de briefing sem auth** (§7.2 #1). | Segurança. | Decidir modelo de auth do cliente. |
| 6 | **Duplo `getClient` no autosave.** | Custo/latência. | Consolidar (§8.1). |

---

## 12. Critérios de aceite (Definition of Done para o deploy)

- [ ] `/` redireciona para `/north`; `/north` carrega "ADM NORTH".
- [ ] Slug inválido → 400; inexistente/inativo → 404; sem env → 503.
- [ ] Briefing salva por slug e persiste após reload; sem versionamento; dados isolados por cliente.
- [ ] 3 links, métricas, insights, relatório e feedback vêm do banco e variam por slug.
- [ ] Nenhuma chave privada no frontend; rota admin exige token; URLs validadas como HTTPS.
- [ ] Decisão registrada sobre auth de escrita do briefing (§7.2 #1).
- [ ] Variáveis definidas na Vercel (Prod/Preview/Dev) apontando para o **projeto Supabase correto**.
- [ ] Migration de RLS aplicada e verificada; free tier não pausado no dia da demo.
- [ ] Funciona em desktop e mobile.

---

## 13. Roadmap técnico (pós-MVP, por prioridade)

1. **Segurança de escrita do briefing** + rate limit + validação HTTPS.
2. **`POST /api/admin/client`** (criação atômica) + UI/CLI de cadastro.
3. **Consolidar payload em 1 query** (embeds/RPC) e remover lookup duplicado.
4. **Migration-base com o DDL** (§4.6) para portabilidade Docker.
5. **Keep-alive / anti-pausa** do Supabase (se aplicável ao plano).
6. **Login de cliente** (quando houver dados sensíveis) e histórico/auditoria do briefing.
7. **Empacotamento Docker** (`web + postgres + postgrest`) quando escalar.

---

### Regra central (inalterada)
> O `slug` define qual cliente acessa o portal. O servidor resolve o cliente pelo slug, carrega os dados vinculados por `client_id` e garante que qualquer alteração seja aplicada **somente** ao registro correspondente — sem versionamento e sem vazamento entre clientes.
