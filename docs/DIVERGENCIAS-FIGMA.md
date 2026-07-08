# Divergências Figma × Implementação — North Portal

_Gerado em 2026-07-04. Metodologia: 3 agentes de exploração (Admin / Portal do Cliente / Site Público) percorreram os nós do Figma (fileKey `I1nVg0mJH169Mv7IdVC67M`, espelhado em `dqw8Ddrdfi6D8xjdkWwVo8`) via Figma MCP e compararam screenshot-a-screenshot contra o código real. ~160 divergências encontradas. Prioridades: **P0** bug real · **P1** alto valor (Fase 1) · **P2** consistência/cosmético · **P3** backlog (schema novo/decisão de produto)._

> ✅ **Fase 1 CONCLUÍDA (2026-07-04)** — os 19 itens marcados **P1** abaixo foram implementados e verificados a olho no Chrome (claro+escuro): bugs reais corrigidos, páginas de auth unificadas ao design system do site, 404 recomposta fiel ao Figma, interação "segurar para ampliar" nos Planos, mocks da Landing com opacidade/cores variadas, hover/lift em cards, tokens de cor nomeados, Kanban com progresso+avatar+colunas novas, Documentos com ação primária invertida, nome real do admin na sidebar, Dashboard e Documentos do cliente lendo dados reais (`client_results`/`documents`). Fase 2/3 seguem como backlog (ver seção final).
>
> **Lição aprendida sobre FOUC (item 19):** a primeira tentativa (lazy-init lendo `localStorage` na inicialização do `useState`) foi **revertida** — o servidor sempre renderiza o tema padrão "light" (sem acesso a `window`), então o cliente lendo um valor diferente do cache causa **erro de hidratação real** do React ("Recoverable Error", a árvore inteira é descartada e regenerada no cliente), pior que o flash original. Voltamos ao padrão seguro `useState("light")` + `useEffect` de correção pós-montagem em `SiteFrame`/`AdminShell`/`useSiteTheme`; no Portal do Cliente, o cache (`north-portal-theme`) agora é aplicado num efeito **logo após montar** (antes do fetch de rede confirmar o tema real), reduzindo a espera sem quebrar a hidratação. Uma correção de zero-flash de verdade exigiria resolver o tema no servidor (cookie lido no Server Component) — registrado como item de backlog.

Plano de execução ativo: `~/.claude/plans/validated-plotting-aho.md` (Fase 1 = itens marcados abaixo; Fase 2/3 = seção final deste doc).

---

## ADMIN

### Sidebar (`481:662`)
- Segundo item de nav: Figma = "PROCESSOS" (caps, ink quando ativo); código = "Tarefas", cor ativa `--a-teal-text` — P2
- Ícones do Figma variam por item (⊞/◉/✓/▤/▥/◎); código reusa glifos genéricos (ex. "▤" duplicado em Tarefas e Performance) — P2
- Item "Configurações" no Figma tem indicador de notificação (engrenagem+ponto); código não tem — P2
- Card de conta mostra nome real do usuário no Figma; código fixa "Administrador" — **P1** (Fase 1 #15)

### Clientes (`295:3`)
- Chips de filtro divergem: Figma = Todos/Ativos/Onboarding/Pausados; código = Todos/Ativos/Inativos/Briefing pendente. "Onboarding"/"Pausado" não existem no schema (`clients` só tem `is_active`) — P3 (schema)
- Colunas da tabela divergem: Figma = Cliente/Segmento/Plano/Status/Onboarding%; código = Cliente/Slug/Status/Briefing/Atualizado/Ações. Segmento/Plano/% não são modelados — P3 (schema)
- Onboarding% com barra de progresso no Figma — sem equivalente calculado — P3

### Cadastro de cliente (`297:2`)
- Figma tem 3 seções ricas (Dados da empresa, Plano & escopo, Responsável & acesso); código só tem Nome+Slug+toggle ativar — ~90% dos campos ausentes — **P3, prioridade alta no backlog** (schema: segmento, plano_tier, escopo[], valor_mensal, contract_start, responsavel_nome/whatsapp, credenciais)
- Checklist "AO CRIAR" do Figma (4 automações: usuário RLS, onboarding 20 perguntas, pasta Drive+card Kanban) não tem nenhuma automação real no POST handler — P3
- Toggles "Enviar convite/Criar onboarding/Criar pasta Drive" inexistentes — P3

### Kanban · Quadro (`358:2`)
- Figma não tem `<select>` de cliente único — 4 chips de filtro iguais (Responsável/Prioridade/Tipo/Cliente) implicando board cross-cliente; código força um cliente por vez — P3 (mudança de API), **não corrigido** (mudança de arquitetura da API/rota)
- ✅ "⚙ Atributos" só aparece na Tabela agora (corrigido 2026-07-04)
- Colunas: Figma tem 6 estágios (Entrada/Em planejamento/Em produção/Aprovação Interna/Aguardando Cliente/+Concluído); código tem 5 (`task_status` enum) — **P3, backlog** (migração de enum), **não corrigido**
- Cards do Figma têm subtítulo de categoria + badge de workflow secundário; código só tem tipo+título+responsável+prioridade — ✅ barra de progresso corrigida (Fase 1 #12); subtítulo/badge secundário ainda P3 (precisa de novos campos payload)
- ✅ "+ Adicionar tarefa" por coluna implementado (corrigido 2026-07-04) — abre "Nova Tarefa" com a etapa da coluna pré-selecionada
- ✅ **Drag-and-drop implementado, setas ‹› removidas (corrigido 2026-07-04)** — arrastar entre colunas muda o status; arrastar sobre um card específico reordena (insere antes dele); reordenação usa posições inteiras espaçadas (múltiplos de 10), só faz PATCH dos cards cuja posição/status realmente mudou

### Kanban · Tabela (`358:72`)
- Faltam colunas Prazo e Progresso; Responsável é texto plano em vez de avatar colorido — **P1** (Fase 1 #13)
- Filtro "Responsável" ausente (Figma tem 5 chips: Tipo/Status/Prioridade/Cliente/Responsável) — P2
- Status/Prioridade deveriam ser pills coloridas, hoje é texto plano — P2

### Kanban · Detalhe (`358:142`)
- Responsável deveria ser avatar+nome; código usa input de texto plano — P2 (assignee é texto livre, não vinculado a usuário)
- Resto da estrutura (Atributos/Descrição/Atividade) fiel ao Figma — sem gap material

### Kanban · Calendário (`374:2`)
- Cor do pill vem de `payload.barTone/statusTone` (editável, pode divergir do tipo); Figma implica cor fixa por categoria — P2
- Nav de mês/Hoje fiel — sem gap
- ✅ **Drag-and-drop implementado (corrigido 2026-07-05)** — arrastar um pill para outro dia muda `due_date`; reaproveita o mesmo padrão `dragId` do Quadro. Testado de ponta a ponta (persistência confirmada no Supabase).

### Modais de Tarefa · Criativo/Agendamento/Desempenho (`462:189/263/337`)
- Header em gradiente cheio no Figma — conferir se `.tm-head-${type}` está com gradiente real ou cor chapada — P2 (QA visual)
- Stepper reusa `COLUMNS` (5 estágios/rótulos do Kanban) mas Figma pede vocabulário próprio "Briefing→Produção→Revisão→Aprovação" (4 estágios fixos) — P3 (mesmo tema do gap de enum acima)
- Grid de atributos: ícones do Figma sugerem avatar de pessoa para Responsável; código usa input plano — P2
- Descrição/Comentários estruturalmente fiéis — sem gap material

### Modal · Nova Tarefa (`462:411`)
- Radio dos type-cards (preenchido no selecionado, vazio nos outros) — conferir tratamento exato — P2 (QA visual)
- Preview de título+cliente fiel; grid pré-preenchido no Figma com exemplos (código deixa vazio) — cosmético, não é gap real

### Modal · Documento (`375:2`)
- Faltam campos Versão/Autor/Validade no painel Detalhes — sem coluna no schema `documents` — P3 (schema)
- Status "Aprovado" do Figma não existe no enum (`DocumentStatus`); "Aprovar documento" usa "publicado" como stand-in — P2/P3 (taxonomia)
- Preview é 100% mock estático (barras cinzas) — nenhum PDF real é renderizado — P3 (precisa de Storage real, já no backlog)

### Modal · Config Atributos (`375:65`)
- Drag handles inertes (tooltip "Ordem fixa") — confirmado, decisão consciente — P3 (baixa prioridade)
- Coluna "Kind" deveria ser dropdown editável; código é texto estático (`ATTR_DEFS` hardcoded) — P3

### Aprovações (`299:2`)
- Fila do Figma agrega Criativo/Onboarding/Campanha/Documento; código só puxa de `tasks` (3 tipos) — Onboarding/Documento são estruturalmente impossíveis hoje — P3 (modelo unificado)
- "Lembrar cliente" é só toast local, zero rede — confirmado, P3 (canal de notificação)
- Meta "Interno · Ana → Júlia" implica handoff entre pessoas; schema só tem 1 `assignee` — P3

### Documentos (admin) (`311:2`)
- Clique na linha abre form de edição simples; só o link "Abrir" abre o preview polido que bate com o Figma — **P1** (Fase 1 #14, inverter a ação primária)
- Resto (filtros, tabela, avatar, pills) fiel ao Figma — sem gap material

### Configurações (`299:133`)
- Faturamento/Integrações são stubs "em breve" — confirmado, P3
- Equipe & papéis é somente leitura (sem convite/troca de papel/remoção) — confirmado, P3 (precisa Admin API)
- Copy da Aparência promete "salvo por usuário" mas hoje é só `localStorage` (por navegador) — reflete gap real de backend (preferência não persiste por usuário) — P3
- Cards de Políticas fiéis pixel-a-pixel — sem gap

### Configurações · Conta (`323:2`)
- Nav deveria ser agrupada (CONTA DO USUÁRIO / PLATAFORMA) com subtítulos; código é lista plana sem grupos — P2/P3
- Tela de Perfil PESSOAL (nome/@handle/e-mail readonly/avatar 5 estilos) não existe — "Perfil da agência" é uma entidade diferente (organização, não usuário) — **P3, backlog** (schema: `profiles.username`+`avatar_style`)
- Aparência por conta (distinta da nota em Políticas) não existe separadamente — P2/P3

### Cross-cutting (tokens)
- `.admin-brand .admin-mark`/`.pf-dot` misturam hex cru (`#7bb0a6`) com token — **P1** (Fase 1 #11)
- `.admin-pill.off` usa hex cru em vez de token — **P1** (Fase 1 #11)
- `.kb-type.t-agendamento`/`.t-desempenho`, `.tone-gold` usam hex cru sem override de tema escuro — **P1** (Fase 1 #11)

---

## PORTAL DO CLIENTE

_Cobertura confirmada: os 12 frames do Figma mapeiam 1:1 para as 12 `PageId` do código — nada está totalmente não-construído._

### Header/Nav (global)
- Itens de nav com dropdown deveriam ter "▾"; código só mostra o texto — P2
- Header alternativo do Figma (pill "☰ Bússola" única) não existe; código sempre usa hambúrguer+toggle+avatar separados — P2
- **Footer "Contato" aponta para `/logout` (desloga o usuário!)** — **P0/P1** (Fase 1 #1, bug real)
- Overlay "MAIS:" e Footer: links de Política/Termos/Planos/Como funciona fixam `href="#inicio"` (mortos) — **P1** (Fase 1 #2, já existem rotas reais no site público)

### Home (`269:3`)
- Compass da Home usa `ALL_ITEMS` (9 pontos) mas Figma mostra só 4 (N/L/S/O) — P2
- Resto (banner, stats, cream band) fiel — sem gap

### Jornada / Central de pendências (`2025:89`)
- Figma: "7 pendências · 2 obrigatórias · 3 documentos · 2 leituras" com item extra "Guia de Stories"; `portalData.ts` tem só 6/1 leitura — P2 (conteúdo, `portalData.ts`)

### Briefing (`270:2`, café `2158:2`)
- Contagem de steps/cards (12/18) fiel — sem gap
- Logo-dot no header do café não deveria existir (Figma é só texto) — P2
- Forma do SVG da xícara diverge (cilíndrica vs. bojuda) — P2
- Perguntas longas sem textarea maior — P2

### Central Comercial (`271:2`)
- Falta o 4º checkpoint "Renovação semestral · Previsto" (marcador oco) — P2 (conteúdo)
- Datas divergem (30 jun vs 02 jul) — P2 (conteúdo)
- "Ver contrato"/"Ver faturas" sem `href`/`onClick` — P3 (ação decorativa)

### Acessos & Pastas (`272:2`)
- "Conceder"/"Gerenciar" sem `onClick`, sem tabela de grants — P3

### Feedbacks/Entregas (`273:2`)
- "Solicitar ajustes"/"Aprovar entrega" sem `onClick`/API; `entregas.pending` não vem de `tasks` (diferente do Plano de Ação) — P3

### Documentos (`274:2`)
- Badge de tipo deveria ser colorido por categoria; código é sempre cinza — **P1** (Fase 1 #18)
- "Baixar"/"Abrir" sem `href` — resolvido junto com o wiring (Fase 1 #17)
- `getPortalPayload` nunca lê a tabela `documents`; página é 100% estática — **P1** (Fase 1 #17)
- `doc_type` do admin não mapeia limpo pros chips do cliente (proposta→Contratos precisa de mapeamento explícito) — considerar ao implementar #17

### Agenda (`274:104`)
- "Entrar no Google Meet"/"Solicitar reunião" sem ação, sem tabela de reuniões — P3

### Time North (`275:2`)
- Botões WhatsApp/E-mail sem `href` real (`wa.me`/`mailto:`); faltam campos de telefone/e-mail no modelo — P3

### Plano de Ação (`275:78`)
- Avatar de Responsável deveria ser círculo colorido por tom (como Time North); código usa quadrado cinza neutro — P2
- Fiel e corretamente ligado à tabela `tasks` via `planoFromTasks` — sem gap material

### Dashboard (`277:2`)
- Barras deveriam ter 2 tons (semanas antigas mais claras); código usa gradiente uniforme — P2
- `client_results` chega no payload mas nunca é lido pelo Dashboard — **P1** (Fase 1 #16)
- Sem ação "Ver relatório"/"Ver feedback" correspondendo a `reportUrl`/`feedbackUrl` — resolvido junto com #16

### Configurações (`319:2`)
- "E-mail de acesso" é `${slug}@north.test` fabricado; `clients` não tem coluna email real, `auth.users.email` nunca é exposto — P3
- Header usa variante "☰ Bússola" (mesmo tema acima) — P2

### Overlay bússola (`2167:2`)
- Letras N/S deveriam ter tratamento especial (grandes, fora do anel); código trata as 4 uniformemente — P2
- Faltam marcadores de ponto nos 4 cardeais do anel — P2

### Dropdown mega-menu (`307:2`)
- Mesmos gaps de caret/header alternativo acima — P2

### Tokens (portal.css)
- `.tone-green/gold/blue/purple` (capas Entregas) usam hex cru, nunca adaptam ao tema — **P1** (Fase 1 #11)
- `html[data-portal-theme] body` duplica `--np-bg` como hex literal — P2
- `#fff` espalhado em vários lugares em vez de `--np-on-primary` — P2 (inofensivo hoje, risco futuro)

### FOUC de tema
- `theme` inicia `"light"`, só corrige após fetch assíncrono resolver; sem cookie/script bloqueante — flash garantido em cliente com preferência escura — **P1** (Fase 1 #19)

### Responsivo
- Em ≤560px o hambúrguer some junto com o wordmark — **usuário fica sem navegação** — **P0/P1** (Fase 1 #3, bug real de alta severidade)
- Sidebar do Briefing (lista de steps) some em ≤860px, perdendo contexto de progresso — P2

### Backend cross-cutting (Portal)
- `PortalPayload.results` buscado e não usado (#16), `documents` sem wiring cliente (#17), sem tabela de reuniões (Agenda), sem mutação de Feedbacks a partir de `tasks`, e-mail de Config fabricado — todos P3 exceto #16/#17 que entraram na Fase 1 por reusarem dado já existente

---

## SITE PÚBLICO

### Sitewide / SiteFrame
- Footer da Landing no Figma é minimalista (1 linha); código usa o footer elaborado de 4 colunas em toda página incl. Landing — P2
- Nav das páginas legais deveria ser reduzida (sem Quem somos/Planos); código usa nav completa em toda rota — P2
- **Login/Recuperar-senha/404 sem toggle de tema** (Figma tem) — **P1** (Fase 1 #4)
- Anel decorativo atrás do card de auth ausente — P2 (parte do #4)
- **Cartões vidro (auth) vs. opacos (site) — duas linguagens visuais coexistindo sem componente compartilhado** — **P1** (Fase 1 #4, é a divergência mais visível de toda a auditoria)
- Radius (24px auth vs 16-20px site), peso de fonte Fraunces (500 auth vs 400 site), gradiente da marca (2 fórmulas diferentes) — **P1** (Fase 1 #4)
- `.auth-screen` duplica um set `--l-*` numericamente idêntico a `--s-*` — nenhuma fonte única — P2 (risco de drift, parte do #11)
- Hex cru duplicado: `#2f5f57` (brand-dot/qs-glass-dot), `#06181b` (dark on-teal), `.mock-day span.s{#efe6cf}` sem override escuro, hovers hardcoded — **P1** (Fase 1 #11)
- `.hero-arrows` não reposiciona em tablet, pode sobrepor o texto — P2
- Nenhum card do site tem hover/lift; só botões/links reagem — **P1** (Fase 1 #10)

### Landing (`2004:137`)
- Dots do slider deveriam variar tamanho (ativo pill, inativo bolinha); código só muda cor — P2
- Seta "anterior" extra além do spec do Figma (só "próximo" no design) — P2 (funcionalidade a mais, não necessariamente errado)
- Seção "Serviços" (catálogo) inserida sem correspondência no Figma — conteúdo extra deliberado, manter — informativo
- Cores dos KPIs do mock Baita: Figma usa 3 cores (teal/sand/teal-escuro), código usa 1 cor para todos — **P1** (Fase 1 #9)
- Fundo do KPI tile diverge (`--s-bg` no Figma vs `--s-band` no código) — P2
- Barras do mock Baita: Figma tem 14 barras com opacidade alternada, código tem 12 barras chapadas — **P1** (Fase 1 #9)
- Cor do texto inativo na sidebar do mock Prime diverge levemente — P2
- Densidade de eventos por dia no mock Prime (Figma varia por dia, código é sempre 2 blocos alternando por índice) — **P1** (Fase 1 #9)
- Depoimentos fiéis 1:1 — sem gap

### Planos (`411:438`) + hold-state (`411:715`)
- **Interação "pressionar e segurar" para ampliar o Growth totalmente ausente** (sem handlers, sem hint de texto) — **P1** (Fase 1 #8, feature faltante confirmada)
- Disclaimer de rodapé adicionado além do Figma — conteúdo extra, informativo
- Preço/copy/badges fiéis — sem gap
- CTAs Start/Growth→`/login`, Custom→`mailto:` — decisão de produto a confirmar, não necessariamente errado — P3

### Como funciona (`411:970`)
- Fiel ao Figma (steps, cream band, footer) — sem gap

### Quem somos (`2031:2`)
- Ícone da bússola decorativo bem mais simples que o dial do Figma (sem marcas de tick) — P2
- Ponto do glass-card menor que no Figma — P2
- Resto fiel — sem gap

### Legal — Política/Termos/Cookies (`411:1308`/`411:1473`)
- Falta o sumário lateral fixo (TOC com 7 âncoras numeradas) do Figma — arquitetura de informação diferente (hoje só abas no topo) — P3 (rework de IA maior)
- Corpo do Figma é estruturado em seções numeradas com heading+número teal; código renderiza texto único `pre-wrap` — P3 (precisa suportar Markdown/rich text)
- Kicker deveria ficar acima do H1 com nome do doc; código mostra status de publicação abaixo do H1 — **P1** (Fase 1 #7)
- Seed do banco (`legal_docs`) tem só placeholder de 1 linha, não o conteúdo estruturado real do Figma — P3 (conteúdo, não código)
- Pipeline admin→público confirmado funcionando (edição em Configurações chega na página pública) — sem gap, apenas confirma que a infra está correta

### Recuperar Senha (`411:1638`) / Sucesso (`411:1695`)
- Rótulo do botão diverge ("Enviar link de acesso" vs "Enviar link →") — **P1** (Fase 1 #6)
- Rodapé com "Acesso seguro · RLS" que só deveria aparecer no Login — **P1** (Fase 1 #6)
- Estado de sucesso sem ícone de check — **P1** (Fase 1 #6)
- Estado de sucesso não deveria ter o brand row (Figma omite) — **P1** (Fase 1 #6)
- Copy do sucesso é deliberadamente mais seguro contra enumeração de contas — manter, é melhoria válida — informativo

### 404 (`411:1734`)
- **Composição totalmente diferente**: Figma = numeral translúcido gigante + anel fino, sem card de vidro, sem brand row; código = tudo dentro do `.auth-card` padrão — **P1** (Fase 1 #5)
- Copy diverge ("Rota perdida" vs "Página não encontrada") — **P1** (Fase 1 #5)
- CTA com seta na posição errada — **P1** (Fase 1 #5)

### Login (`288:3`)
- Fidelidade mais forte de toda a auditoria — únicos gaps são o toggle de tema ausente (#4) e o anel decorativo (#4)
- Posição vertical do card ligeiramente mais alta no Figma — P2 (imperceptível)

---

## Resumo Fase 2/3 (backlog, não executado nesta rodada)

Ver `~/.claude/plans/validated-plotting-aho.md` para o plano completo. Itens que precisam de schema novo ou decisão de produto antes de implementar:

1. **Cadastro de cliente** — expansão de ~90% dos campos (segmento/plano/escopo/valor/contrato/responsável) + automações de criação.
2. **Vocabulário do Kanban** — alinhar enum de 5→6 estágios com os rótulos do Figma. (Processo de revisão/revisor em si já implementado 2026-07-05 — ver `docs/HANDOFF-PLATAFORMA-NORTH.md` §2.1; falta só o enum de estágios.)
3. **Aprovações unificadas** — modelo cross-entidade (tasks+onboarding+documentos). (Tasks já ganhou a aba "Em revisão" 2026-07-05; falta unificar com onboarding/documentos.)
4. **Configurações › Conta pessoal** — perfil individual (@handle, avatar, tema por usuário).
5. **Equipe & papéis** — convite/criação real de usuário via Supabase Admin API; contas individuais por colaborador North (hoje só existe um `admin` compartilhado) para viabilizar o modelo Editor < Revisor < Admin de verdade.
6. **Documentos com Storage real** — upload real em vez de URL.
7. **Notificações reais** — canal de e-mail/in-app para "Lembrar cliente" e afins.
8. **Config Atributos** — drag-reorder funcional + "kind" editável.
9. **Sumário lateral + corpo estruturado** nas páginas legais (rework de IA).
10. **FOUC de tema, correção definitiva** — resolver o tema no servidor (cookie lido em Server Component) em vez de `localStorage`+efeito client-side, eliminando o flash de fato em vez de só reduzi-lo. Afeta Admin, Site Público, Portal do Cliente e páginas de auth.
11. **Aprovação do lado do cliente** — hoje o Plano de Ação do cliente é só leitura; falta um botão real de "aprovar"/"pedir ajuste" que dispare uma mudança de status (fechando o loop revisor→cliente iniciado em 2026-07-05).
12. **Cards com riqueza visual do Figma** — subtítulo de categoria + badge de workflow secundário (precisa de novos campos no `payload`).
13. **Kanban cross-cliente** — Figma sugere um quadro único misturando clientes; código força um cliente por vez.
