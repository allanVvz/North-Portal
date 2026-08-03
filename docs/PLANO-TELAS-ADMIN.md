# Plano das próximas telas — Portal Admin North

> ✅ **PLANO TOTALMENTE EXECUTADO (2026-07-04).** Todas as telas abaixo (Aprovações, Documentos, Configurações › Políticas, Onboarding, Performance, Plano) foram construídas e verificadas. Mantido aqui como registro histórico da decisão/arquitetura de cada uma. Estado atual completo (incl. o Kanban com preview lateral + modal central + Config Atributos + preview de Documento) está em `docs/HANDOFF-PLATAFORMA-NORTH.md`.

_Atualizado em 2026-07-03. Branch `feat/auth-admin-portal`._

Referência de design: arquivo Figma **prod `I1nVg0mJH169Mv7IdVC67M`**, página **Admin (Operacional) `295:2`** e espelho L↔D `365:2`.

## Estado atual (o que já está concluído)

| Tela | Figma | Código | Status |
|---|---|---|---|
| Login (glass) | `288:3` | `app/login/page.tsx` | ✅ |
| Clientes (lista) | `295:3` | `app/admin/page.tsx` + `ClientsTable.tsx` | ✅ |
| Cadastro de cliente | `297:2` | `app/admin/novo/page.tsx` | ✅ |
| Editor de cliente | — | `app/admin/[slug]/page.tsx` + `ClientEditor.tsx` | ✅ (links, métricas, insights, relatório, conteúdo JSON, ativar) |
| **Kanban / Tarefas** | `358:2` Quadro · `358:72` Tabela · `374:2` Calendário | `app/admin/kanban/page.tsx` + `KanbanBoard.tsx` | ✅ **concluído nesta sessão** — 3 views (Quadro/Tabela/Calendário) + barra de filtros (Tipo/Prioridade/busca) + CRUD com toggle "visível ao cliente" |

**Backend (Supabase `rqwycltgnnvaunvmyxea`) — todas as 5 migrations aplicadas e saudáveis:**
`init_client_portal_schema` · `auth_profiles` · `rls_by_role` · `tasks` · `client_content_and_prefs`.
Tabelas: `clients`, `profiles`, `briefing_answers`, `client_drive_links`, `client_results`, `tasks`, `client_content`, `client_prefs` — todas com RLS por papel (`is_admin()` / `owns_client()`).

O Kanban conclui a **peça central** da tela de Administrador. As telas abaixo são as **próximas** a construir, em ordem de prioridade.

---

## 1. Aprovações — `299:2` · **prioridade ALTA · esforço S/M**

Fila de aprovação com abas **Aguardando cliente / Interno / Resolvidas**. Cada linha: thumb, chip de tipo, nome do cliente, título, meta (`Aguardando cliente · há 1 dia` ou `Interno · Ana → Júlia · há 3h`) e ações (`Lembrar cliente` para itens de cliente; `Ajustes` + `Aprovar` para internos).

**Reaproveita a tabela `tasks` — não precisa de migration:**
- Aba **Aguardando cliente** = tasks `status='aprovacao'` E `client_visible=true`.
- Aba **Interno** = tasks `status='aprovacao'` E `client_visible=false`.
- Aba **Resolvidas** = tasks `status='concluido'`.
- `Aprovar` → PATCH status `concluido`. `Ajustes` → PATCH status `revisao`. `Lembrar cliente` → toast (notificação real fica como TODO futuro).

**A construir:**
- API `GET /api/admin/approvals` (lista **cross-client** tasks em `aprovacao`/`concluido` via `requireAdmin`; a rota de tasks atual é por-slug, esta é global).
- UI `app/admin/aprovacoes/page.tsx` (server, `requireAdmin`) + `ApprovalsQueue.tsx` (abas, linhas, ações otimistas reusando o padrão de `KanbanBoard`).
- CSS `.ap-*` no fim do `globals.css` (tokens `--a-*`, claro+escuro).
- Ligar nav do `AdminShell` (hoje "Aprovações" está `em breve`).

**Por que primeiro:** máximo reuso do que já existe (tasks + RLS + padrão de UI), fecha o loop Kanban→Aprovação, zero risco de schema.

---

## 2. Documentos — `311:2` · **prioridade MÉDIA · esforço M**

Tabela de documentos. Filtros **Todos / Contratos / Relatórios / Materiais / Por cliente**. Colunas: Documento (ícone PDF + nome), Cliente (avatar + nome), Tipo, Data, Status (`Assinado`/`Enviada`/`Publicado`/`Aguardando assinatura`/`Compartilhado`), `Abrir`. Botão `↑ Enviar documento`.

**Precisa de migration nova** `2026…_documents.sql`:
```sql
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  doc_type text not null check (doc_type in ('contrato','proposta','relatorio','material')),
  status text not null default 'enviada'
    check (status in ('enviada','assinado','aguardando_assinatura','publicado','compartilhado')),
  file_url text,            -- v1: link (Drive/URL); v2: Supabase Storage
  doc_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: admin full (is_admin); cliente lê os próprios (owns_client) para a página Documentos do portal.
```

**A construir:**
- Schema `documentCreate/documentPatch` em `lib/validation.ts`.
- API `/api/admin/documents` (GET?type&slug, POST) + `/api/admin/documents/[id]` (PATCH, DELETE), `requireAdmin`.
- UI `app/admin/documentos/page.tsx` + `DocumentsTable.tsx` (chips de filtro + tabela + modal "Enviar documento").
- **Decisão pendente:** upload real (Supabase Storage bucket `documents`) vs. só URL no v1. Recomendo **URL no v1** (mesma abordagem dos drive links), Storage no v2.
- Alimentar a página **Documentos do portal do cliente** (`app/[slug]`) com esses registros (hoje é estático em `portalData.ts`).

---

## 3. Configurações — `299:133` (+ Conta `323:2`) · **prioridade MÉDIA · esforço M/L**

Sub-nav: **Perfil da agência / Equipe & papéis / Políticas / Faturamento / Integrações** + bloco **Aparência** (toggle Claro/Escuro — já existe no `AdminShell`).

Fatiar por sub-área (entregar incremental):
- **Políticas & documentos legais** (Privacidade/Termos/Cookies com badge `Publicada` + `Editar`): nova tabela `legal_docs (slug, title, body_md, status, updated_at)` **ou** `site_settings (key, value jsonb)`. Estes textos alimentam as páginas públicas. **Recomendo começar por aqui** (fecha a ponta pública).
- **Equipe & papéis**: gerir usuários admin/staff (tabela `profiles` já existe; precisa de convite/criação de usuário — hoje via `scripts/create-user.mjs`). Esforço maior (Auth admin API).
- **Aparência**: já pronto no shell — só mover o controle para esta tela.
- **Faturamento / Integrações**: placeholders `em breve` no v1.

---

## 4. Onboarding (admin) — nav `CONTEÚDO › Onboarding` · **prioridade BAIXA · esforço M**

Visão de acompanhamento do onboarding por cliente (o cliente já tem a jornada/central de pendências no portal). Admin veria progresso do briefing (`briefing_answers.submitted`) e checklist. Pode reusar `briefing_answers` + `tasks`. Sem migration.

## 5. Performance / Plano de Ação (admin) — nav `RESULTADOS` · **prioridade BAIXA · esforço S**

Em grande parte **já cobertos**: o Plano de Ação do cliente é alimentado pelas tasks `client_visible` (Kanban), e as métricas de Performance são editáveis no `ClientEditor` (`client_results`). As telas dedicadas do admin são polish — podem redirecionar para o editor do cliente + Kanban no v1.

---

## Ordem recomendada de execução

1. **Aprovações** (reuso puro de `tasks`, sem migration) — fecha o ciclo do Kanban.
2. **Documentos** (1 migration + Storage/URL) — entrega valor visível ao cliente.
3. **Configurações › Políticas** (alimenta páginas públicas) → depois Equipe & papéis.
4. Onboarding admin · Performance/Plano admin (polish, muito reuso).

## Pendências transversais (fazer junto)
- **Wiring do `AdminShell`**: remover `em breve` conforme cada tela nasce; adicionar grupo **`SISTEMA › Configurações`** (hoje ausente); opcional renomear "Tarefas" → "Processos" (Figma usa `PROCESSOS`).
- **Escritas no portal do cliente** que faltam: aprovar entregas/feedbacks, Agenda, Documentos (pareiam com as telas 1–2 acima).
- **Notificações** ("Lembrar cliente", avisos de aprovação): definir canal (e-mail/in-app) — hoje é TODO.

## Como validar cada tela
- `npx tsc --noEmit` (o `next build` corrompe `.next` se o `next dev` estiver rodando — parar o dev antes).
- Rota compila + gate de auth: `HttpWebRequest` sem redirect deve retornar **307 → /login** quando deslogado.
- A olho no Chrome logado como `admin@north.com` (senha `SenhaForte123!`), tema claro **e** escuro.
# Padrões reutilizáveis de atributos

## Multisseletor compacto

O seletor de **Responsável** é a referência para atributos que aceitam múltiplos valores sem transformar o modal em um formulário pesado:

- valores escolhidos aparecem como chips removíveis;
- o botão circular `+` abre as opções disponíveis;
- criação livre fica dentro do dropdown, sem texto de instrução permanente;
- clique fora e `Escape` fecham o seletor;
- cada remoção possui `aria-label` específico e o controle continua utilizável por teclado;
- o estado serializado deve ser normalizado em uma função de domínio, não dentro do JSX.

Use esse padrão quando houver seleção múltipla real e o conjunto couber num popover. O atributo **Data** reutiliza a mesma gramática visual: chips de datas, botão `+` e calendário multisseleção. Não usar para escolhas mutuamente exclusivas, ações destrutivas ou listas extensas que exijam busca e paginação.

## Header e footer do modal de tarefa

- O header de edição tem três zonas responsivas: identidade (voltar, tipo, título e cliente), progresso e ações. O progresso deve ocupar a coluna central disponível entre identidade e lateral direita; nunca usar `left: 50%` do modal como alinhamento fixo.
- A lista de etapas deve ser filtrada antes do render. O conector é desenhado conforme o índice da lista **visível**, nunca conforme o catálogo completo; isso impede uma linha solta quando Revisão, Aprovação ou Publicado estiverem desligados.
- Em larguras menores, o progresso pode ocupar uma segunda linha, sem `border-top`: a quebra responsiva não deve inventar um separador visual.
- O footer (`Excluir`, `Cancelar`, `Salvar`) é irmão de `.tm-layout`, nunca filho de `.tm-main`: assim ocupa a base estrutural do modal em desktop e mobile, sem ficar antes do painel de comentários quando as colunas empilham. O conteúdo central rola por trás dessa base fixa e deve existir respiro entre a descrição e o footer.
- A descrição cresce conforme o conteúdo até um limite; depois usa rolagem vertical interna. Não usar altura fixa que deixe texto cortado nem crescimento ilimitado que expulse o footer da tela.
- A navegação pai → execução usa histórico local por `id`. Um `router.refresh()` pode atualizar os dados do card, mas não pode reiniciar `activeTask` quando o `id` raiz continua igual; caso contrário, abrir uma execução futura volta imediatamente ao pai e o botão Voltar desaparece.
