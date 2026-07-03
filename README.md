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

```bash
npm run dev
```

Validacoes:

```bash
npm run lint
npm run typecheck
npm run build
```

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

## Estado atual

O deploy compila e a pagina `/north` responde. Para a API funcionar em producao, configure as variaveis protegidas na Vercel. Sem `SUPABASE_SERVICE_ROLE_KEY`, `GET /api/client/north` retorna `503`.

## Design (Figma)

Arquivo: **Plataforma North** — fileKey `dqw8Ddrdfi6D8xjdkWwVo8`. Design system v4 "Nevoa Sage" (claro) + petroleo (escuro), Fraunces + Inter, glassmorphism. Manual de marca em `design_system.md`.

### Paginas de producao (interativas)
- **North · Publico** (`288:2`): Landing, Login (liquid glass), Planos, Como funciona, Quem somos, Politicas, Recuperar Senha, Sucesso, 404.
- **North · Cliente (Bussola)** (`269:2`): Home/bussola, Briefing, Central Comercial, Acessos & Pastas, Feedbacks, Documentos, Agenda, Time North, Plano de Acao, Dashboard, Menu bussola, Dropdown, Configuracoes.
- **North · Admin (Operacional)** (`295:2`): Clientes, Cadastro, Aprovacoes, Configuracoes, Documentos, Sucesso, e **Gestao de Tarefas** (ver abaixo).

### Gestao de Tarefas (Kanban + Tarefas unificados, inspirado no Notion)
Uma tela, 3 visualizacoes com toggle no header (Quadro / Tabela / Calendario):
- **Quadro** (`358:2`): board Kanban com 5+ colunas, cards com tags/prioridade/responsavel/prazo.
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
