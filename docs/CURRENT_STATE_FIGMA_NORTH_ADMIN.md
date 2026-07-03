# Estado Atual — Figma "Plataforma North" + Tarefas pendentes

> **Handoff doc.** Escrito antes de reiniciar a sessão (Figma MCP caiu). Contém: estado completo do arquivo Figma, o que já foi feito, e a **última tarefa (pendente, detalhada)** para executar assim que o `claude.ai Figma` MCP reconectar. Nada de código do app foi alterado — tudo vive no Figma.

- **Figma fileKey (CORRIGIDO — sessão 12):** o trabalho do protótipo (páginas 288/269/295, L↔D 365:2/3/4, manual, café) vive em **`I1nVg0mJH169Mv7IdVC67M`** ("Plataforma-North-**prod**"). O antigo `dqw8Ddrdfi6D8xjdkWwVo8` ("Plataforma North") está **desatualizado** (hoje só tem a página `29:2`); NÃO usar para este protótipo. Ambos compartilham o mesmo namespace de IDs (prod é cópia/branch).
- **MCP necessário:** `claude.ai Figma` → ferramentas `mcp__claude_ai_Figma__use_figma`, `get_screenshot`, `get_metadata`. Estava **desconectado** ao pausar. Ao reabrir: confirmar que `use_figma` está disponível (ToolSearch `select:mcp__claude_ai_Figma__use_figma`).
- **Memória viva relacionada:** `~/.claude/projects/C--Repositores-north-portal/memory/north-saas-figma.md` (sessões 1–8). Este doc espelha e detalha o pendente.

---

## Sessão 18 — 2026-07-02 · Execução do plano de pendências (ícones, menu legado, Admin L↔D, footer dark, validação)

Executado o `docs/PLANO-FIGMA-PENDENCIAS.md`. Resultado por fase:

- **Fase 0 (auditoria):** `295:2` = 19 frames; Admin L↔D `365:2` = 34 frames **já com BFS PASS** e estrutura limpa (não precisou regenerar). Engrenagem = glifo `⚙` TEXT dentro de cada variante do component set `Sidebar/Admin` (`481:662`, 12 variantes).
- **Fase 1 · Ícones (P1/P2):**
  - **Engrenagem (P2):** `⚙` substituído por **cog vetorial** (estrela 8-pontas em traço + furo central, agnóstico ao tema) nos **12 masters** do `481:662`. Como as sidebars são **instâncias**, propagou automaticamente para sources **e** Admin L↔D (verificado: `gearPropagated=true`, 0 emoji restante).
  - **Ícones de tipo (P1):** `TypeIcon` (48×48) dos 3 modais redesenhados e centrados — **Criativo** = moldura de imagem + play (roxo); **Agendamento** = calendário (cabeçalho + presilhas + grade de dias, âmbar); **Desempenho** = barras crescentes + seta ↑ (teal). Feito nos sources (`462:192/266/340`) **e** nos 6 clones do Admin L↔D (`489:6372/6446/6520/6594/6668/6742`).
- **Fase 2 · Menu Bússola (P4):** 0 refs operacionais restantes a `434:2`/`306:2` (já repointadas na S17 → Natural `2167:2`). Legado `434:2` renomeado `[LEGADO] … (v1)` e movido para faixa fora da grade (`x=-2000 y=8000`). No L↔D o rótulo do par legado marcado como `[legado v1]`.
- **Fase 3 · Admin L↔D (`365:2`):** **atualização cirúrgica** (não regeneração — página já saudável): engrenagem via instância + TypeIcons dos modais atualizados. BFS mantido PASS.
- **Fase 4 · Footer dark (P5):** único footer creme em tela dark era **Planos dark** (`411:576`, footer `411:702`, lum 0.86) → escurecido (darkify da subárvore) para petróleo legível. "Como funciona" já estava ok.
- **Fase 6 · Validação total:**
  - **BFS PASS** nas 3 L↔D: `365:2` (34), `365:3` (34), `365:4` (22) — todos `invalid=0`, `noOutbound=0`, `reachesAll=true`.
  - **Dark-on-dark (background-aware):** achados só em iniciais de avatar/`✓` escurecidos pelo darkify → recoloridos p/ creme (**6** Admin + **3** Cliente + **0** Landing). **0 remanescentes.**

### Diferido (fora do escopo desta rodada, baixo impacto)
- **P6 Header como componente `Cliente/Header`** (variantes Theme) + passe de fonte global — polimento de robustez.
- **P7 Links cross-page** (rodapé Cliente/Admin → Política/Termos no Landing): **limitação dura do Figma** (NAVIGATE só intra-página). Decisão: **aceitar e documentar** (não quebra travessia). Alternativa futura: copiar Política/Termos para dentro de `365:3`/`365:2`.
- **P9 Gatilho de modal por tipo** (cards sem chip caem no default): aceitável no MVP; revisar se algum card específico precisar de destino distinto.
- **P10:** Manual web (`2123:2`) e Guia de Stories (`2170:2`) permanecem como **sections editoriais navegáveis por deck** — **não** entram como pares L↔D (mesmo critério do manual). Decisão registrada.

---

## Sessão 17 — 2026-07-02 · Briefing, Café, Agenda, Menu Bússola (2 versões) e Guia de Stories

Arquivo prod `I1nVg0mJH169Mv7IdVC67M`. Fonte = `269:2`; espelho = `365:3`.

### 1. Briefing (`270:2`) — uma caixa por pergunta (obrigatórias)
- Antes: 1 caixa de texto por card temático (cobria 4+ perguntas). Agora: **cada pergunta tem seu próprio campo** (label com dot âmbar + input inset), nota "Todos os campos são obrigatórios" por card. Cards reconstruídos em auto-layout dentro de `270:85` (couberam nos 669px → sem esticar a tela). Perguntas vêm de `app/[slug]/content.ts` (`briefSteps`, 12 seções; a tela do protótipo mostra a Etapa 1: `b1_historia` 5 Qs + `b1_quem` 6 Qs).

### 2. Café → tela 0 do briefing, web 1440×1024, clara + escura
- **Café claro** novo `2158:2` (bg névoa, xícara SVG **reaproveitada** do antigo e recolorida teal, "Pegue um café." + "Vamos dar forma à sua marca.", botão "Começar o briefing →" → `270:2`). Posicionado isolado em `x360 y-1400`.
- **Café escuro 1920×1080 antigo `2001:1866` REMOVIDO da `269:2`** (3 refs repointadas → `2158:2`). No **L↔D**, o par café = clone claro + **darkify** (petróleo) — a versão escura vive só no `365:3`, conforme pedido.

### 3. Agenda (`274:104`) — calendário mensal
- "Próximos eventos" encurtado (tinha espaço vazio). Abaixo, **calendário Julho 2026** full-width (`2161:2`): grade 7×5, legenda (Reunião/Entrega/Gravação/Post), eventos por dia (chips soft). Frame cresceu 1134→1420; footer reposicionado.

### 4. Menu Bússola — novo layout + 2 versões (original `434:2` preservado)
- **Novo layout**: menu no topo, título no centro, **bússola embaixo** (antes era compass no meio + menu embaixo).
- **vA "Hold · Jornada" `2164:2`**: item "Jornada & Onboarding" destacado/elevado, **agulha apontando SSW** (agulha antiga bugou ao rotacionar grupo → refeita via `createVector` do centro real), título grande central "Jornada & Onboarding" + descrição.
- **vB "Natural" `2167:2`**: agulha em repouso (N), sem título grande (só "A agulha segue você") — estado natural p/ seguir o mouse em prod. **Operacional**: cada item do menu → sua tela; Fechar → Home; bússola-refs da `269:2` repointadas `434:2`→`2167:2`.
- Técnica de rearranjo: agrupar nós da bússola (todos com `w<440` no bbox do compass) via `figma.group`, mover menu p/ topo, mover o grupo compass p/ baixo (+452), títulos ao centro.

### 5. Guia de Stories — novo fluxo obrigatório (adaptado de `Guia-stories.html`)
- Deck de **17 telas web 1440×1024** na section `2170:2` ("04 · GUIA DE STORIES · WEB 1440"), grade 4×5, tema petróleo/creme alternado, Fraunces+Inter, capa com bússola clonada `269:24`. Conteúdo fiel ao HTML (jornada Conexão→Problema→Processo→Valor→Conversão, PSI, sequência do dia, passos 0–4, funil DM, bônus calendário semanal + ativação de base). Deck navegável (click→próximo). Entrada obrigatória adicionada na central de pendências (`2025:89`, row "Guia de Stories" → `2170:3`).

### 6. Mirror L↔D `365:3`
- Pares **Briefing** e **Agenda** substituídos (clone claro + darkify escuro); linhas abaixo da Agenda deslocadas +286 (Agenda ficou mais alta). Anexados ao fim: **Café** (claro+escuro), **Menu Hold** (claro+escuro), **Menu Natural** (claro+escuro).
- Cadeia de travessia + toggles **reconstruídos do zero** (remove `PrototypeNext` antigos, re-ordena por y/x, re-encadeia). **BFS: 34 frames, invalid=0, noOutbound=0, reachesAll=true — PASS.**
- Guia de Stories e Manual permanecem como **sections editoriais** (não entram como pares L↔D, igual ao manual).

---

## Sessão 16 — 2026-07-02 · Fluxo do Cliente (manual web, central de pendências, footer claro, layout, mirror L↔D)

Arquivo prod `I1nVg0mJH169Mv7IdVC67M`. Foco: **página Cliente (Bússola) `269:2`** e seu espelho **`365:3`**.

### 1. Manual do Cliente → 9 telas web 1440×1024 (era slide 16:9 1920×1080)
- Nova **section `2123:2`** "02 · MANUAL DO CLIENTE · WEB 1440", grade 3×3 (col 0/1560/3120, row 0/1144/2288). 9 frames: `2123:3` Capa · `2129:2` Boas-vindas (mock de celular) · `2124:71` Checklist (creme) · `2124:2` Como funciona · `2124:47` Cronograma (creme) · `2124:26` Recomendações · `2127:2` Deveres · `2128:2` Atendimento · `2126:2` Encerramento.
- **Tipografia unificada em Fraunces** (a capa/boas-vindas/encerramento usavam DM Serif + Playfair — era a inconsistência). Título romano + palavra-acento **Fraunces Light Italic teal**, gap de 18px entre elas (largura de texto ignora espaço final → colava).
- **Bússola/agulha corrigida**: capa e encerramento **clonam a bússola operacional `269:24`** (agulha bicolor DS: vetor gold `286:13` N + vetor teal `286:14` S, hub glass). A agulha "triângulo gordo + toco cinza" antiga saiu.
- **Deck wired**: cada tela `ON_CLICK → próxima` (09→01); back-link `←  BOAS-VINDAS` → `2129:2`; Encerramento CTA → Home `269:3`; Checklist "Responder briefing" → café `2001:1866`.
- **Manual antigo removido**: section `2001:1975` (9 slides 1920×1080) + frames-fonte soltos `2001:1887/1908/1932/1954`. 18 reações que apontavam para os slides antigos foram **remapeadas** para as novas telas antes de apagar.

### 2. "Sua jornada começa aqui" (`2025:89`) → Central de Pendências
- Deixou de ser 2 cards (Manual/Briefing) e virou a **central de notificações do cliente**: resumo ("6 pendências no total") + 3 grupos de linhas acionáveis — **ETAPAS OBRIGATÓRIAS** (Manual→`2123:3`, Briefing→café `2001:1866`), **DOCUMENTOS PENDENTES** (Contrato/Planilha→`274:2`, Acessos→`272:2`), **LEITURAS PENDENTES** (Política de conteúdo→`274:2`). Frame cresceu p/ 1400px, footer no fundo.
- **Nota de escopo** explícita: "Só pendências aparecem aqui. Suas atividades, agenda e reuniões ficam na bússola." (atividades/agenda **não** aparecem, por requisito).

#### Novo fluxo da jornada (documentado)
```
Home (269:3)
  └─ Banner "Manual do Cliente · Pendente · Abrir"  →  Central de Pendências (2025:89)
Central de Pendências (2025:89)  ← hub de tudo que exige ação
  ├─ Manual do Cliente      → Manual/Capa (2123:3) → deck 9 telas → CTA Encerramento → Home
  ├─ Briefing               → Pausa p/ café (2001:1866) → Briefing (270:2)
  ├─ Contrato / Planilha    → Documentos (274:2)
  ├─ Acessos das plataformas→ Acessos & Pastas (272:2)
  └─ Política (leitura)     → Documentos (274:2)
Atividades / agenda / reuniões  →  NÃO entram na central; vivem na Bússola (Home + Agenda 274:104).
```

### 3. Layout da página `269:2` — sem sobreposição
- Home (1560), Feedbacks (1258) e Onboarding (1400) eram mais altos que o passo de grade (1124) → sobrepunham vizinhos. **Regrade completa**: colunas 0/1560/3120/4680, linhas espaçadas pela **altura real da linha + 180**. 14 telas do app, **0 sobreposições** (checado por AABB). Café e manual (canto) isolados.

### 4. North · Feedbacks (ed) `273:2`
- Panorama confirmado como grade 4-col consistente (2 containers-linha `2094:8` + linha de baixo, tiles 281px). Thumbnails da lista "Aprovados recentemente" (`273:78/88/98`) preenchidos com gradientes de marca (estavam cinza-vazios).

### 5. Footer claro névoa-sage padronizado + Bússola operacional
- **Footer claro** (bg surface2 `#E7EAE5`, borda-topo `#D7DDD6`, logo ink + PORTAL/links/© muted, dot teal). Home `333:22` e Onboarding `2027:2` **recoloridos** de petróleo→claro; **clonado** para as 10 telas restantes (Briefing/Central/Acessos/Feedbacks/Documentos/Agenda/Time/Plano/Dashboard/Config), cada frame estendido +110px. (Dropdown/Menu overlays mantêm rodapé de links próprio.)
- **Bússola Home operacional**: botão bússola `☰`→Menu `434:2`; compass `269:24`→Menu; nav North→Feedbacks `273:2`, Performance→Dashboard `277:2`; chips (onboarding/pendências→`2025:89`, reunião→Agenda `274:104`); card Aprovações→`273:2`.

### 6. Espelho L↔D `365:3` regenerado
- Página **reconstruída do zero** a partir dos sources atualizados: 14 pares (Home, Central de Pendências, Briefing, Central Comercial, Acessos, Feedbacks, Documentos, Agenda, Time, Plano, Dashboard, Config, Dropdown, Menu Bússola). Coluna clara (x=0) = clone direto (já traz o footer claro); coluna escura (x=1560) = clone + **darkify type-aware** — o darkify converte o footer claro→petróleo automaticamente = **espelho do footer** pedido.
- **Bug clone**: `clone()` preserva gatilhos mas **zera `destinationId` (null)** → todas as reações herdadas viraram inválidas. Solução: **strip** de reações null/inválidas (38 nós) + **rewire** próprio da página: toggles de tema (par claro↔escuro, 22), botão bússola→menu da coluna (22) e **cadeia de travessia** via hotspot invisível `PrototypeNext` (46×46, top-left, fill opacity 0.001) encadeando as 28 telas.
- **Título com fills mistos** (ex.: "Sua jornada começa *aqui*") era pulado pelo darkify (`node.fills` = `mixed`, não-array) → escuro-sobre-escuro. Corrigido por passe de **`getStyledTextSegments`/`setRangeFills`** (remapeia por segmento).
- **Menu Bússola escuro**: source antigo `306:2` **não existe mais** neste arquivo → dark = darkify do menu claro `434:2` (fallback).
- **Travessia BFS**: `frames=28 · invalid=0 · noOutbound=0 · reachesAll=true` (start `2146:2`). **PASS.**

### Mapa de ids L↔D (source 269:2 → claro / escuro)
`269:3`→`2146:2`/`2147:2` · `2025:89`→`2146:113`/`2147:114` · `270:2`→`2146:212`/`2147:214` · `271:2`→`2146:364`/`2147:367` · `272:2`→`2146:548`/`2147:552` · `273:2`→`2146:720`/`2147:725` · `274:2`→`2146:866`/`2147:872` · `274:104`→`2146:980`/`2147:987` · `275:2`→`2146:1079`/`2147:1087` · `275:78`→`2146:1167`/`2147:1176` · `277:2`→`2146:1286`/`2149:2` · `319:2`→`2146:1480`/`2149:197` · `307:2`→`2146:1571`/`2149:289` · `434:2`→`2146:1638`/`2149:357`.

---

## Sessão 12 — em andamento em 2026-07-01 (arquivo prod `I1nVg0mJH169Mv7IdVC67M`)

Nova rodada no arquivo **prod**. Convenção de darkify agora é **type-aware**: mapas de cor de TEXTO (ink→cream, secondary, muted) só se aplicam a nós `TEXT`; superfícies petróleo já-escuras (ex.: app-shell do case Prime) permanecem escuras. Map base (surfaces/accents) via distância euclidiana < 0.05.

### Concluído nesta sessão
- **Landing L↔D completa (`365:4`)**: a landing curta/incompleta foi **substituída pela landing longa completa** clonada do source `293:2` (hero slider → Resultados em números → Cases Baita+Prime → Depoimentos → footer). Claro = `2004:137`; Escuro = `2006:137` (darkify type-aware). Frames antigos `411:4`/`411:182` removidos.
- **Manual do Cliente — apresentação final de 9 slides (estilo DS)** consolidada na **section `2001:1975`** (página `269:2`), 1920×1080 cada:
  - `2001:1978` 01 Capa · `2001:2096` 02 Boas-vindas · `2015:155` 03 Checklist (creme) · `2011:185` 04 Como funciona · `2012:179` 05 Cronograma (creme) · `2012:203` 06 Recomendações · `2012:225` 07 Deveres · `2014:161` 08 Atendimento e prazos · `2001:2939` 09 Encerramento.
  - Slides 04–07 = clones dos DS P1.2–P1.5 (footers renumerados `/09`). Slides 03 e 08 reconstruídos no estilo DS. Slides 01/02/09 convertidos do "totalmente black" → petróleo DS (bg `#0C2A2C`, barra de acento no topo, remoção das ~90 scanlines, títulos Fraunces cream+italic teal, footer `Manual · 0X / 09`). iPhone/compasso preservados.
  - **Tokens DS**: petróleo bg `[0.047,0.165,0.173]`; creme bg `[0.867,0.816,0.71]`; headline Fraunces Regular 72/68 + **Light Italic** (accent teal `[0.478,0.682,0.671]`/`[0.373,0.627,0.612]`); kicker Inter Medium 14 ls4; back-link `←  BOAS-VINDAS` Inter Medium 13 ls3; footer Inter Regular 13.
  - **Protótipo do deck**: cada slide `ON_CLICK → próximo` (09 volta à Capa); back-link `←  BOAS-VINDAS` → slide anterior (7 wired).
  - **Excluído**: `173:77` (a versão 9-black antiga, na página `173:2`), conforme pedido.

### Concluído — pacote novo + Quem somos
- **Café antes do briefing**: `2001:1866` clonado como `2022:89` "00 · Pausa para o café" em `218:2`, à esquerda de Briefing 01 (`218:350`); frame + botão "Começar o briefing →" wired → `218:350`. Café source (`2001:1866`) na página Cliente wired → `270:2` (etapa Briefing do cliente).
- **Jornada Cliente**:
  - **Tela nova** `Cliente · Onboarding (etapa obrigatória)` = **`2025:89`** (page `269:2`, x=3080 y=2248), estilo névoa-sage: header clonado, headline Fraunces "Sua jornada começa aqui", 2 cards de ação → **Manual** (card+botão → `2001:1978`) e **Briefing** (→ café `2001:1866` → `270:2`), chips "Obrigatório", barra de progresso "0 de 2 etapas", footer.
  - **Banner obrigatório** `2028:2` na Bússola Home (`269:3`), absoluto no topo (x120 y94), chip "Pendente" + botão "Abrir →", wired → `2025:89`.
  - Slide 03 botão `Responder briefing →` (`2015:212`) → café `2001:1866`; slide 09 CTA `Abrir versão publicada` (`2001:3053`) → Home `269:3`.
- **Quem somos L↔D completo (`365:4`)**: substituído pela versão completa do source `305:77` (compass "As pessoas por trás da operação" + 3 C-level + Nossos números). Claro = `2031:2`; Escuro = `2031:166` (darkify type-aware). Antigos `411:1123`/`411:1215` removidos; **pares abaixo (Política→404) deslocados +740px** para acomodar a altura 2100.

### Wiring dos 3 L↔D — CONCLUÍDO + validado
Wiring por **mapa label→destino** (exact-ish match nos nós TEXT) em cada coluna (claro→destinos claros; escuro→destinos escuros); theme-toggle `☾`/`☀` → par oposto; matching normaliza (remove `→›»·✕⚙`, lowercase).
- **Landing `365:4`** (público): header nav (North/Como funciona/Planos/Políticas/Quem somos/Entrar), footer legal, fluxos auth (Login→Recuperar→Sucesso→Login; 404→Landing). Novos frames religados: landing `2004:137`/`2023:1817`, quem somos `2031:2`/`2031:166` (dark estava mal-parenteada em `240:2` → movida p/ `365:4`).
- **Cliente `365:3`**: header (Início/Cliente/North/Performance + `☰`→Menu Bússola), links do Menu Bússola (Visão geral/Briefing/Central/Acessos/Feedbacks/Documentos/Agenda/Time North/Plano/Dashboard/Configurações).
- **Admin `365:2`**: sidebar (Clientes→Clientes, Processos→Quadro, Aprovações, Documentos, Onboarding→Cadastro, Performance→Tabela, Plano de Ação→Calendário, Configurações), view toggle `⊞/≡/▦`, `+ Nova tarefa`→Modal Nova Tarefa; **modais por gatilho**: chips de tipo Criativo/Agendamento/Desempenho→modal do tipo, `Atributos`→Config Atributos, linhas de doc→Modal Documento; **fechar/cancelar/criar/salvar**→volta (Quadro/Documentos/Tabela).

### Validação de travessia (script BFS por página) — TODAS PASS
| Página | Frames | invalid | noOutbound | reachesAll |
|---|---:|---:|---:|---|
| `365:2` Admin | 34 | 0 | 0 | true |
| `365:3` Cliente | 26 | 0 | 0 | true |
| `365:4` Landing | 22 | 0 | 0 | true |

### Observações / limitações
- **Cross-page** continua rejeitado pelo Figma: links de footer legal nas páginas Cliente (`365:3`) não navegam para as telas de Política/Termos (que vivem em `365:4`) — limitação conhecida, sem quebra de travessia.
- Gatilhos de modal por tipo usam heurística de **chip de tipo** no card; cards sem chip caem no default. Revisar se algum card específico precisar de destino diferente.

---

## Sessão 13 — normalização ThemeToggle + contraste dark (2026-07-01, prod `I1nVg0mJH169Mv7IdVC67M`)

### ThemeToggle normalizado em todas as telas públicas (`365:4`)
- **Regra estrutural (NUNCA posição absoluta em pixel — causava sobreposição)**: o gap entre "Políticas" e "Entrar" é de só ~16px, então um pill 34px não cabe por posicionamento absoluto → sobrepunha "Políticas". A correção é **inserir o toggle como filho flex do header row (auto-layout HORIZONTAL, gap 16)**, no índice **imediatamente antes do botão "Entrar"** (entre o grupo de nav e o Entrar). O espaçador `FILL` do header encolhe e o auto-layout distribui tudo → **impossível sobrepor**. 34×34/radius 17, `layoutSizing FIXED`. Fallback absoluto `x=1198`/top20 só nas telas de auth (Login/Recuperar/Sucesso/404, sem nav — não colide com nada).
- **Estilo por tema**: dark → pill `rgba(232,220,192,0.16)` + borda `rgba(232,220,192,0.35)`, glifo **☀** creme `#E8DCC0`; light → pill `rgba(12,44,44,0.05)` + borda `rgba(12,44,44,0.15)`, glifo **☾** ink `#0C2C2C`. Glifo Inter Semi Bold 15, centralizado via auto-layout do pill.
- Toggle **criado em Quem somos** (`2031:2`/`2031:166`, que não tinha) e recriado limpo em todos (remove pills antigas + glifos ☀/☾ soltos → 1 pill correta por frame). Reação `☾`→par escuro / `☀`→par claro.

### Automação anti-regressão — script idempotente (inserção flex, sem sobreposição)
Rodar este `use_figma` sempre que um toggle for adicionado/movido. Ele remove pills/glifos antigos e **insere o toggle no fluxo do header auto-layout** entre nav e Entrar. Idempotente.
```js
// P = [[lightId, darkId], ...] dos pares de nav de 365:4 (Landing, Planos, Hold, Como, Quem, Política, Termos)
const cream={r:232/255,g:220/255,b:192/255}, ink={r:12/255,g:44/255,b:44/255};
function anc(n){const a=[];while(n){a.push(n);n=n.parent;}return a;}
async function mk(frame, theme, dest){
  for(const n of frame.findAll(x=>/ThemeToggle/.test(x.name)||(x.type==='TEXT'&&/^[☀☾]$/.test((x.characters||'').trim())))){try{n.remove();}catch(e){}}
  const pol=frame.findOne(n=>n.type==='TEXT'&&/^pol[íi]ticas$/i.test((n.characters||'').trim()));
  const ent=frame.findOne(n=>n.type==='TEXT'&&/^entrar$/i.test((n.characters||'').trim()));
  if(!pol||!ent) return; // auth pages → manter fallback absoluto x=1198,y=20
  const polSet=new Set(anc(pol).map(x=>x.id));
  let row=null; for(const x of anc(ent)){ if(polSet.has(x.id)){row=x;break;} } // LCA = header row HORIZONTAL
  if(!row||row.layoutMode!=='HORIZONTAL') return;
  let entChild=ent; while(entChild.parent&&entChild.parent.id!==row.id) entChild=entChild.parent;
  const idx=row.children.indexOf(entChild); // inserir ANTES do Entrar
  const tog=figma.createFrame(); tog.name='ThemeToggle';
  tog.layoutMode='HORIZONTAL'; tog.primaryAxisAlignItems='CENTER'; tog.counterAxisAlignItems='CENTER';
  tog.primaryAxisSizingMode='FIXED'; tog.counterAxisSizingMode='FIXED'; tog.resize(34,34); tog.cornerRadius=17; tog.strokeWeight=1;
  if(theme==='dark'){tog.fills=[{type:'SOLID',color:cream,opacity:0.16}];tog.strokes=[{type:'SOLID',color:cream,opacity:0.35}];}
  else{tog.fills=[{type:'SOLID',color:ink,opacity:0.05}];tog.strokes=[{type:'SOLID',color:ink,opacity:0.15}];}
  const g=figma.createText(); g.fontName={family:'Inter',style:'Semi Bold'}; g.fontSize=15;
  g.characters=theme==='dark'?'☀':'☾'; g.fills=[{type:'SOLID',color:theme==='dark'?cream:ink}]; tog.appendChild(g);
  row.insertChild(idx, tog);
  tog.layoutSizingHorizontal='FIXED'; tog.layoutSizingVertical='FIXED'; tog.layoutGrow=0; tog.resize(34,34);
  tog.reactions=[{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:dest,navigation:'NAVIGATE',transition:null}]}];
}
```

### Contraste dark corrigido (`2023:1817` + auditoria)
- Bug de origem: o **darkify** aplicava `cream/band [0.910,0.863,0.753] → dark` também a **texto creme** sobre heróis/rodapés escuros → texto escuro sobre fundo escuro (L≈0.17). **Correção da convenção (§2): o mapa `cream→dark` NÃO deve tocar nós `TEXT`** (só superfícies). Manter TEXT_MAP (ink→cream etc.) só em TEXT e BASE_MAP sem cream em TEXT.
- **Correção aplicada (background-aware)**: recolorir para creme apenas texto escuro cujo **fundo é escuro** (`bgLum<0.45`), preservando texto escuro sobre botões claros (ex.: CTA teal "Começar agora"/"Entrar" do login). Passe corretivo reverte creme→ink onde o fundo é claro **incluindo gradientes** (botões primários auth usam gradiente teal — o check de bg precisa considerar GRADIENT, não só SOLID).
- Resultado: dark landing legível (hero "clareza", cases PRIME/Agenda, rodapé). Quem-dark, login/recuperar/sucesso/404 dark auditados e corrigidos.
- **Pendência menor conhecida** (fora do escopo desta rodada): alguns dark frames (Planos/Como) têm **rodapé creme** (darkify não escureceu o footer) — texto muted legível, mas visualmente é footer claro em tela dark. Escurecer esses rodapés numa próxima passada.

### Validação
- Toggle: 22 pills, todas 34×34/top20, entre Políticas e Entrar (ou fallback 1198). Screenshots (Planos dark, Quem light, Login dark) confirmam. Travessia `365:4` continua PASS (22 frames, invalid=0, noOutbound=0).
- Contraste: auditoria final sem texto escuro-sobre-escuro; remanescentes são muted-em-footer-creme e ícones de acento teal (legíveis).

### Deferido (mensagem 365:2 — próximo plano)
- Ícones de tipo (Criativo/Agendamento/Desempenho) fora de centro; **calendário** deve parecer calendário; **desempenho** deve parecer gráfico crescendo.
- Ícone **⚙ Configurações** errado → trocar por vetor de engrenagem no component set `Sidebar/Admin` (`481:662`, nós de glifo `481:48`/`481:103`) e propagar a todas as sidebars/telas.
- Corrigir sidebar + processo de espelho/darkify+protótipo no `365:2`.

---

## Sessão 14 — botão bússola normalizado + automação de header (Cliente `365:3`)

### Correção
- O **botão bússola** (`BtnBussolaMenu`, círculo 38×38 com ☰) deve ficar **à esquerda, logo após o logo** (≈16% da largura) em TODOS os headers cliente. Estava errado (pill de texto "☰ Bússola" à **direita**) em **Config** (`436:2667`/`436:2749`) e **Dropdown** (`436:2530`/`436:2598`) — corrigido: removida a pill, inserido o círculo à esquerda (clonado de `436:10` light / `436:111` dark, que já apontam para o Menu Bússola do tema certo).
- **Auditoria**: 24 frames com `BtnBussolaMenu` @16%, **0 pills** restantes. (As 2 telas de Menu Bússola full-screen não têm header — usam "Fechar ✕".)

### Fonte (ler antes de mexer em header) — `design_system.md`
- **Fraunces** (serif): heros/títulos editoriais, com **itálico de acento em teal**. **Inter**: corpo, labels, microtipografia; **wordmark "north" em Inter pesado (Extra Bold), caixa-baixa**. Nav = Inter Medium. Manter isso em qualquer header novo/alterado.

### Automação de header (script idempotente reutilizável)
Normaliza a bússola à esquerda em qualquer header cliente. **Detectar o logo por "PORTAL"** (não por "north" — o item de nav "North" casaria por engano). Dois casos:
- **Header auto-layout (HORIZONTAL)**: `row.insertChild(logoIdx+1, circleClone)` + `layoutSizing FIXED 38`.
- **Header absoluto (`layoutMode==='NONE'`, ex. Dropdown)**: `header.appendChild(circleClone)` + `clone.x = logoRightRel + 14`, `clone.y = avatarTopRel`.
```js
const chars=n=>{try{return n.type==='TEXT'?(n.characters||''):'';}catch(e){return '';}};
async function normBussola(frameId, srcBtnId){ // srcBtnId: 436:10 (light) / 436:111 (dark)
  const frame=await figma.getNodeByIdAsync(frameId);
  const busText=frame.findOne(n=>n.type==='TEXT'&&/☰|bússola/i.test(chars(n)));
  if(!busText) return; // já normalizado (só círculo, sem pill)
  let node=busText, hdr=null, wrapper=null;
  while(node.parent){const p=node.parent; if(('findOne'in p)&&p.findOne(x=>x.type==='TEXT'&&/portal/i.test(chars(x)))&&('children'in p)&&p.children.length>=3){hdr=p;wrapper=node;break;} node=p;}
  const logo=hdr.children.find(c=>('findOne'in c)&&c.findOne(x=>x.type==='TEXT'&&/portal/i.test(chars(x))));
  const avatar=hdr.children[hdr.children.length-1];
  const lb=logo.absoluteBoundingBox, hb=hdr.absoluteBoundingBox, ab=avatar.absoluteBoundingBox;
  wrapper.remove();
  const clone=(await figma.getNodeByIdAsync(srcBtnId)).clone();
  if(hdr.layoutMode==='HORIZONTAL'){ hdr.insertChild(hdr.children.indexOf(logo)+1, clone); clone.layoutSizingHorizontal='FIXED'; clone.layoutSizingVertical='FIXED'; clone.resize(38,38); }
  else { hdr.appendChild(clone); clone.x=Math.round((lb.x+lb.width)-hb.x+14); clone.y=Math.round(ab.y-hb.y); clone.resize(38,38); }
}
```
- **"Alterar a fonte e alterar em todos"**: rodar um passe que varre todos os headers cliente e aplica a fonte documentada — carregar `figma.loadFontAsync` antes e `t.fontName=...` (wordmark Inter Extra Bold; nav Inter Medium). Como todos os `BtnBussolaMenu` são clones do mesmo source, editar o source e re-clonar propaga estilo; para consistência total, considerar transformar o header em **componente `Cliente/Header` (variantes Theme=Light/Dark)** numa próxima passada.

---

## Sessão 15 — HeaderCover dos modais de tarefa realinhado (Criativo/Agendamento)

**Golden reference = `Modal · Tarefa · Desempenho`.** Criativo (`462:189`) e Agendamento (`462:263`) ainda estavam com `HeaderCover` **h=128** (deveria ser **92**) e o stack de fluxo/conteúdo 8–12px acima do correto → faixa colorida invadindo o fluxo.

Layout canônico do `TaskCard` (aplicado a Criativo e Agendamento, source + clones L↔D `489:6372/6446/6520/6594`):
| Elemento | y | h |
|---|---:|---:|
| HeaderCover | 0 | **92** |
| TypeIcon | 28 | 48 |
| CampaignTitle | 26 | · |
| ClientTitle | 58 | · |
| Close | 28 | 36 |
| Flow/* (dots) | 108 | 22 |
| FlowLine | 119 | 2 |
| FlowLabel/* | 136 | 12 |
| Description | 178 | 118 |
| FieldsGrid | 318 | 214 |
| Dialog | 560 | 214 |
| BtnCancel/BtnSave | 804 | 40 |

Script: `findOne(name==='HeaderCover')` → `card=cover.parent` → iterar `card.children` e setar `y` por nome (cover→`resize(w,92)`). Idempotente. Verificado por screenshot: Criativo (roxo) e Agendamento (sand) agora idênticos ao Desempenho.

---

## Sessão 10 — concluído em 2026-07-01

Executado via Figma MCP no arquivo `dqw8Ddrdfi6D8xjdkWwVo8`.

### Correções finais — sidebar, cards, filtros e protótipo

- **Sidebar Admin normalizada como componente**: criado component set `Sidebar/Admin` com variantes `Theme=Light/Dark` e `Active=Clientes/Processos/Aprovações/Documentos/Performance/Configurações`.
- **Label Kanban removido do padrão de navegação**: item operacional consolidado como **`PROCESSOS`** em todas as sidebars normalizadas.
- **Sidebars source substituídas por instâncias** em `Admin · Clientes`, `Admin · Cadastro de cliente`, `Admin · Aprovações`, `Admin · Configurações`, `Admin · Documentos`, `Admin · Configurações · Conta`, `Admin · Tarefas · Quadro`, `Admin · Tarefas · Tabela`, `Admin · Tarefas · Detalhe` e `Admin · Tarefas · Calendário`.
- **Hotspots da sidebar corrigidos**: navegação transparente por cima da sidebar para manter protótipo funcional sem depender de overrides dentro das instâncias.
- **Cards de tarefa redesenhados nos três tipos** (`Criativo`, `Agendamento`, `Desempenho`): capa compacta, chip de tipo, título sem sobreposição, metadados, status, barra de progresso e footer.
- **Modal · Tarefa · Desempenho**: capa reduzida e fluxo/progresso reposicionado para não invadir a área superior.
- **Admin · Tarefas · Tabela**: `FilterBar` normalizado com chips, busca e botão `Atributos` cabendo na largura útil; `PageHeader`/toggle de visualização ajustados.
- **Admin · Tarefas · Quadro**: cinco colunas do Kanban redistribuídas para caberem no frame após sidebar `256px`; cards reduzidos proporcionalmente sem corte.
- **North · Admin | L↔D regenerado** a partir dos sources corrigidos: 17 pares claro/escuro, sidebar escura via variante `Theme=Dark`, darkify aplicado ao conteúdo e hotspots de toggle L↔D absolutos.
- **Correção de auto-layout dos hotspots**: `SidebarHotspots`, `Hotspot/ThemeToggle` e `PrototypeIndex/Next` ficaram absolutos para não roubar largura do conteúdo.

### Validação final do protótipo

| Página | Frames | Resultado | Destinos inválidos | Sem saída | Travessia |
|---|---:|---|---:|---:|---|
| `North · Admin | L↔D` | 34 | PASS | 0 | 0 | primeiro → último |
| `North · Cliente | L↔D` | 26 | PASS | 0 | 0 | primeiro → último |
| `North · Landing | L↔D` | 22 | PASS | 0 | 0 | primeiro → último |

## Sessão 11 — atualização de modais e handoff Prod em 2026-07-01

Executado via Figma MCP no arquivo `dqw8Ddrdfi6D8xjdkWwVo8`.

### Correção aplicada nesta sessão

- **Modal · Tarefa · Criativo** (`462:189` source) recebeu a mesma correção visual já aplicada em `Modal · Tarefa · Desempenho`:
  - `HeaderCover` reduzido para `92px` de altura.
  - Fluxo horizontal movido para fora da área da capa: dots em `y=108`, linhas em `y=119`, labels em `y=136`.
  - Conteúdo refluído: `Description y=178`, `FieldsGrid y=318`, `Dialog y=560`, botões em `y=804`.
- **Modal · Tarefa · Agendamento** (`462:263` source) recebeu a mesma correção:
  - Header/capa deixa de invadir visualmente o fluxo.
  - Barra de progresso/fluxo fica separada da faixa colorida superior.
  - Grid, comentários e botões mantêm o mesmo ritmo vertical do modal de Desempenho.
- **Clones Admin L↔D atualizados**:
  - Criativo claro `489:6372` e escuro `489:6446`.
  - Agendamento claro `489:6520` e escuro `489:6594`.
  - As cores soft dos headers foram preservadas por tipo e adaptadas ao tema escuro.

### Validação desta sessão

- Screenshot validado de `Modal · Tarefa · Criativo` source: sem invasão do header no fluxo.
- Screenshot validado de `Modal · Tarefa · Agendamento` source: sem invasão do header no fluxo.
- Protótipo `North · Admin | L↔D` revalidado:
  - `frames=34`
  - `invalid=0`
  - `noOutbound=0`
  - `chainCount=34`
  - `reachesLast=true`
  - primeiro frame: `Admin · Clientes`
  - último frame: `Modal · Nova Tarefa`

### Estado detectado das páginas Prod/revisão

O usuário informou que renomeou as telas para Prod. Nesta sessão, o MCP ainda retornou estes nomes e IDs estáveis:

| ID | Nome retornado pelo MCP | Uso atual |
|---|---|---|
| `295:2` | `North · Admin (Operacional)` | Source Admin claro |
| `365:2` | `North · Admin | L↔D` | Protótipo Admin claro/escuro |
| `365:3` | `North · Cliente | L↔D` | Protótipo Cliente claro/escuro |
| `365:4` | `North · Landing | L↔D` | Protótipo Público claro/escuro |
| `269:2` | `North · Cliente (Bússola)` | Source Cliente claro |
| `288:2` | `North · Público (Landing · Login · Políticas)` | Source Público claro |

Para concluir o protótipo completo considerando as **6 telas/páginas Prod**, tratar estes 6 blocos como o conjunto operacional até o MCP refletir os novos nomes.

### Fluxo de atualização correto no Figma

1. **Editar sempre primeiro o source**:
   - Admin source: `295:2`.
   - Cliente source: `269:2`.
   - Público source: `288:2`.
2. **Propagar para a página Prod/L↔D correspondente**:
   - Admin Prod/L↔D: `365:2`.
   - Cliente Prod/L↔D: `365:3`.
   - Landing Prod/L↔D: `365:4`.
3. **Para telas Admin com sidebar**:
   - Usar instâncias do component set `Sidebar/Admin`.
   - Variantes esperadas: `Theme=Light/Dark` e `Active=Clientes/Processos/Aprovações/Documentos/Performance/Configurações`.
   - O item operacional deve permanecer como `PROCESSOS`; não voltar para Kanban/Gestão de Tarefas.
   - Hotspots de navegação ficam por cima da instância (`SidebarHotspots`) porque reactions dentro de instâncias são mais frágeis para rewiring.
4. **Para páginas L↔D/Prod**:
   - Clonar source claro.
   - Criar clone escuro por darkify de conteúdo.
   - Substituir sidebar por variante `Theme=Dark` nos clones escuros.
   - Manter `Hotspot/ThemeToggle` e `PrototypeIndex/Next` com `layoutPositioning='ABSOLUTE'` para não roubar largura do conteúdo.
5. **Para modais de tarefa**:
   - O padrão final é o do Desempenho após a correção:
     - `HeaderCover height=92`.
     - Fluxo em `y=108/119/136`.
     - `Description y=178`.
     - `FieldsGrid y=318`.
     - `Dialog y=560`.
     - Botões em `y=804`.
   - Este padrão já está aplicado em Criativo, Agendamento e Desempenho, tanto no source quanto no Admin L↔D.
6. **Para prototipagem**:
   - `NAVIGATE` só funciona de forma confiável entre frames top-level na mesma página.
   - Reactions cross-page são rejeitadas pelo Figma.
   - Self-nav é rejeitado.
   - Sempre parentar hotspot no frame antes de setar `reactions`.
   - `transition:null` e `actions` plural são obrigatórios.
7. **Validação mínima após cada rodada**:
   - Screenshot das telas alteradas.
   - Script de protótipo por página: `invalid=0`, `noOutbound=0`, `reachesLast=true`.
   - Conferir visualmente se overlays/hotspots absolutos não alteraram auto-layout do conteúdo.

### Pendências atuais para concluir o protótipo completo Prod

- Confirmar no MCP os nomes finais das **6 páginas Prod** depois do rename aparecer na API.
- Rodar validação completa nas 6 páginas/blocos Prod, não só nas 3 L↔D.
- Completar navegação funcional real para todos os itens de sidebar e headers, mantendo `PrototypeIndex/Next` apenas como trilha invisível de auditoria.
- Revisar Cliente Prod:
  - Home Bússola.
  - Briefing.
  - Central Comercial.
  - Acessos & Pastas.
  - Feedbacks.
  - Documentos.
  - Agenda.
  - Time North.
  - Plano de Ação.
  - Dashboard.
  - Configurações.
  - Menu Bússola claro/escuro.
- Revisar Público/Landing Prod:
  - Landing.
  - Login.
  - Planos.
  - Como funciona.
  - Quem somos.
  - Políticas/Termos.
  - Recuperar senha.
  - Sucesso link.
  - 404.
- Revisar Admin Prod:
  - Validar todas as rotas de sidebar com destinos funcionais.
  - Validar Quadro/Tabela/Detalhe/Calendário.
  - Validar modais Documento, Config Atributos, Criativo, Agendamento, Desempenho e Nova Tarefa.
  - Validar dark mode frame a frame após qualquer regeneração.

## Sessão 9 — concluído em 2026-07-01

Executado via Figma MCP no arquivo `dqw8Ddrdfi6D8xjdkWwVo8`.

### Revisão pós-feedback — sidebars, cards e modais

Nova rodada feita após feedback do usuário sobre sidebars antigas e padrão dos cards/modais:

- **Sidebars corrigidas nos sources claros**: `Admin · Clientes` (`295:3`), `Admin · Cadastro de cliente` (`297:2`), `Admin · Aprovações` (`299:2`), `Admin · Configurações` (`299:133`), `Admin · Configurações · Conta` (`323:2`) e `Admin · Documentos` (`311:2`) voltaram para `#FBFCFA`, com texto escuro e ativo em teal-soft. Validação por script confirmou todos os seis sources em `#fbfcfa`.
- **Admin L↔D validado contra espelhamento errado**: pares claros das seis telas acima estão `#fbfcfa`; pares escuros estão petróleo `#0e2e32`. Não há sidebar clara em tela escura nem sidebar escura em tela clara.
- **Cards do Quadro e Detalhe refinados**: cards agora seguem padrão Trello/Notion com capa em fade por tipo, tag de tipo, título obrigatório, cliente/meta e footer com prioridade + prazo. Colunas foram refluídas para evitar sobreposição com `+ Adicionar tarefa`.
- **Modais de tarefa redesenhados** (`Criativo`, `Agendamento`, `Desempenho`): fluxo movido para horizontal no topo, descrição central em caixa própria, grid de campos com ícones conforme o tipo do campo, e área de comentários/atividade com múltiplos comentários e input.
- **Modal · Nova Tarefa**: sem toggle de tema; título/campanha e cliente centralizados, seleção de tipo no topo, campos específicos com ícones (`Prazo` com calendário, `Status`/`Prioridade` com flag, `Responsável` com pessoa, `Formato`/`Plataforma` com layout próprio).
- **Admin L↔D atualizado parcialmente**: clones L↔D de `Admin · Tarefas · Quadro` e `Admin · Tarefas · Detalhe` foram substituídos pelos sources corrigidos; modais L↔D tiveram botões corrigidos para não quebrar texto.
- **Limpeza de protótipo**: removidas 60 reactions herdadas que apontavam para fora da página Admin L↔D.
- **Validação final de travessia**:
  - `North · Admin | L↔D`: 34 frames, alcança o último, `invalid=0`, `noOutbound=0`
  - `North · Cliente | L↔D`: 26 frames, alcança o último, `invalid=0`, `noOutbound=0`
  - `North · Landing | L↔D`: 22 frames, alcança o último, `invalid=0`, `noOutbound=0`

- **Admin · Tarefas · Quadro (`358:2`)**: Kanban refatorado para caber no frame 1440 sem cortar a 5ª coluna. Colunas reduzidas/redistribuídas, cards sem `clipsContent` cortando texto, sombras/bordas normalizadas e filtros com radius/spacing mais limpos.
- **Admin · Tarefas · Detalhe (`358:142`)**: mini-board e filtros superiores normalizados; cards sem corte e chips reposicionados.
- **Theme toggle Admin**: removido/normalizado fora do conteúdo e garantido como `SidebarThemeToggle` pequeno no topo da sidebar quando existe sidebar; em modais sem sidebar, o toggle L↔D fica pequeno no header do card.
- **Novos modais source criados na página Admin (`295:2`)**:
  - `454:2` — `Modal · Tarefa · Criativo`
  - `454:68` — `Modal · Tarefa · Agendamento`
  - `454:134` — `Modal · Tarefa · Desempenho`
  - `454:200` — `Modal · Nova Tarefa`
- **Modal · Config Atributos (`375:65`)**: lista `AttrList` reconstruída com pílulas `TypePill` alinhadas e cadeados por atributo essencial/tipo (`base`/`tipo`), cobrindo Criativo, Agendamento e Desempenho.
- **Prototype source Admin**: cards/linhas/calendário → modais por tipo; `BtnNova` → `Modal · Nova Tarefa`; closes/cancelar/criar → Quadro; view toggle Quadro/Tabela/Calendário normalizado.
- **North · Admin | L↔D (`365:2`)**: página regenerada do zero a partir dos sources atuais. Agora possui **17 pares claro/escuro**: os 13 frames originais + 4 novos modais. O frame legado `252:2` continuou fora.
- **Darkify**: aplicado nos clones escuros com snap por mapa de cores, sem fallback de luminância. Screenshot validado no par escuro de `Admin · Tarefas · Quadro` (`455:2467`).
- **Prototype L↔D**: Admin L↔D teve sidebars, toggles de view, cards e modais rewired para destinos da própria página. As três páginas L↔D receberam hotspots transparentes `PrototypeIndex/Next` para teste de travessia ordenada sem alterar o visual.

### Teste de travessia do protótipo

Script `use_figma` consolidado rodado nas 3 páginas L↔D:

| Página | Frames | Primeiro → Último | Resultado | Destinos inválidos |
|---|---:|---|---|---:|
| `North · Admin | L↔D` (`365:2`) | 34 | `Admin · Clientes` → `Modal · Nova Tarefa` | PASS | 0 |
| `North · Cliente | L↔D` (`365:3`) | 26 | `Cliente · Bússola Home` → `Cliente · Menu Bússola (full-screen)` | PASS | 0 |
| `North · Landing | L↔D` (`365:4`) | 22 | `Público · Landing` → `Público · 404` | PASS | 0 |

Observação: em Cliente/Landing, parte do alcance completo é garantido pelos hotspots transparentes `PrototypeIndex/Next`, usados como trilha de indexação/teste. A navegação funcional existente foi preservada.

---

## 1. Mapa de páginas e frames

### Páginas
| Page ID | Nome | Papel |
|---|---|---|
| `288:2` | North · Público (Landing · Login · Políticas) | telas públicas SOURCE (tema claro) |
| `269:2` | North · Cliente (Bússola) | telas cliente SOURCE (tema claro) |
| `295:2` | North · Admin (Operacional) | telas admin SOURCE (tema claro) |
| `365:2` | North · Admin \| L↔D | revisão claro+escuro lado a lado |
| (por nome) | North · Cliente \| L↔D | revisão claro+escuro |
| (por nome) | North · Landing \| L↔D | revisão claro+escuro |
| `240:2` / `240:3` | Design System / coleção `North/Color` (modos Light/Dark) | tokens |

> As páginas L↔D têm **clones**: coluna clara em `x=0`, coluna escura em `x=largura+120`, pareadas pelo mesmo `y`. Cada frame tem um `ThemeToggle` wired para o par oposto (mesma página → NAVIGATE funciona).

### Público (`288:2`)
- `288:3` Login (liquid glass CLARO; opacidade diluída na sessão 8: card branco 0.46→0.24, BACKGROUND_BLUR 32, blobs ×0.6)
- `293:2` Landing (LONGA, auto-layout vertical ~2990px): Header (toggle entre menu e "Entrar") → Hero **slider** (capa imagem + overlay + dots + seta) → **Resultados em números** (sem imagem) → subdivisão **Cases** (Baita Conveniência + Prime Detailing) → **Depoimentos** (com imagens) → Footer petróleo
- `294:2` Política de Privacidade · `294:83` Termos & Cookies
- `304:2` Planos · `322:2` Planos (hold ampliado) · `305:2` Como funciona · `305:77` Quem somos (com C-level + métricas + bússola pequena)
- `335:2` Recuperar Senha (glass claro) · `335:19` Sucesso Link (glass claro) · `336:2` 404 (claro)

### Cliente (`269:2`)
- `269:3` Home Bússola. Header = `269:4` já no **padrão novo**: [logo] → `BtnBussolaMenu` (ícone círculo+☰) → nav → …spacer… → `ThemeToggle` (☾) → avatar. Compass = `269:24` (disco vidro branco, agulha bicolor sand/teal).
- `270:2` Briefing · `271:2` Central Comercial · `272:2` Acessos & Pastas · `273:2` Feedbacks · `274:2` Documentos · `274:104` Agenda · `275:2` Time North · `275:78` Plano de Ação · `277:2` Dashboard
- Headers internos (mesmo padrão propagado): `270:3, 271:3, 272:3, 273:3, 274:3, 274:105, 275:3, 275:79, 277:3`
- `306:2` **Menu Bússola full-screen = tema ESCURO** (petróleo). `434:2` **Menu Bússola Claro** (bege/névoa, caixas claras, linhas da bússola azul-escuras `#1D2A53`). Rodapé de links (Landing/Planos/Como funciona/Termos/Políticas) nos dois.
- `307:2` Dropdown mega-menu · `319:2` Configurações (SEM header — toggle vive dentro de Configurações)

### Admin (`295:2`)
- `295:3` Clientes · `297:2` Cadastro de cliente · `299:2` Aprovações · `299:133` Configurações · `311:2` Documentos · `323:2` Config · Conta · `336:15` Sucesso — Cliente Criado
- `358:2` **Tarefas · Quadro** (Kanban) · `358:72` **Tarefas · Tabela** · `358:142` **Tarefas · Detalhe** · `374:2` **Tarefas · Calendário**
- `375:2` **Modal · Documento** (close `CloseDoc`) · `375:65` **Modal · Config Atributos** (close `CloseCfg`)
- `252:2` Kanban Operacional antigo 2680px (**DEPRECIADO** — não usar, não incluir em L↔D)
- Toggle de view = frame `Toggle` (3 pílulas `Pill/⊞ Quadro`, `Pill/≡ Tabela`, `Pill/▦ Calendário`). Barra de filtros = `FilterBar`. Botão config atributos na Tabela = `BtnConfigAttr`.

---

## 2. Convenções de design (aplicar em tudo novo)

### Paleta Névoa Sage (Light)
bg `#EEF1ED` (0.933,0.945,0.929) · surface `#FBFCFA` (0.984,0.988,0.980) · surface2 `#E7EAE5` (0.906,0.918,0.898) · inset `#E4E8E2` (0.894,0.910,0.886) · borderS `#DEE3DD` (0.871,0.890,0.867) · borderD `#D7DDD6` (0.843,0.863,0.839) · ink `#0C2C2C` (0.047,0.173,0.173) · secondary `#46584F` (0.275,0.345,0.310) · muted `#7C8A82` (0.486,0.541,0.510) · teal `#5E9C93` (0.369,0.612,0.576) · tealStrong `#4A857C` (0.290,0.522,0.486) · sand `#CDB888`/`#CDB888` (0.804,0.722,0.533) · cream `#E8DCC0` (0.910,0.863,0.753)
Status soft: amberSoft (0.980,0.941,0.859), dangerSoft (0.980,0.894,0.878), greenSoft (0.863,0.941,0.902), purpleSoft (0.906,0.890,0.965); accents amber (0.800,0.604,0.244), danger (0.761,0.376,0.306), green (0.243,0.569,0.420), purple (0.451,0.365,0.714).

### Sidebar admin (tema CLARO)
Após sessão 7: bg surface, texto ink, item ativo teal-soft + barra teal, logo dot teal + "NORTH" ink, borda direita `#DEE3DD`. **No tema ESCURO** vira petróleo (via darkify). Sidebar = frame filho à esquerda, `x≈0`, largura 200–260, alta (>700). Nos frames Tarefas novos chama-se `Sidebar`; nos frames admin antigos é um "Frame" genérico.

### Glass recipe (liquid glass claro)
Card fill = gradiente branco 0.46→0.24 · `BACKGROUND_BLUR 32` · borda gradiente refrativa (white 0.9 → teal 0.5 → sand 0.55 → white 0.35) weight 1.5 · `DROP_SHADOW` teal (0.369,0.612,0.576,a0.20) y18 r48 blendMode NORMAL · blobs = ellipses fill teal/sand opacidade ~0.12–0.20 + `LAYER_BLUR 90`.

### Darkify (light→dark) — snap por distância < 0.05, SEM fallback de luminância
Mapa (rgb light → rgb dark) usado nas páginas L↔D. **Não** mexe em cores já-escuras (sidebar/rodapé petróleo, texto branco ficam intactos).
```
[[0.933,0.945,0.929],[0.039,0.141,0.157]] bg
[[0.984,0.988,0.980],[0.055,0.180,0.196]] surface
[[0.906,0.918,0.898],[0.071,0.204,0.220]] surface2
[[0.894,0.910,0.886],[0.031,0.118,0.133]] inset
[[0.871,0.890,0.867],[0.102,0.227,0.243]] borderS
[[0.843,0.863,0.839],[0.145,0.286,0.298]] borderD
[[0.761,0.792,0.761],[0.227,0.361,0.369]] borderStrong
[[0.047,0.173,0.173],[0.910,0.863,0.753]] ink→cream
[[0.275,0.345,0.310],[0.612,0.706,0.706]] secondary
[[0.486,0.541,0.510],[0.478,0.663,0.639]] muted
[[0.369,0.612,0.576],[0.471,0.675,0.659]] teal
[[0.290,0.522,0.486],[0.369,0.612,0.576]] tealStrong
[[0.863,0.918,0.894],[0.055,0.227,0.220]] tealSoft
[[0.910,0.863,0.753],[0.086,0.188,0.204]] cream/band
[[0.804,0.722,0.533],[0.545,0.478,0.325]] sand
[[0.243,0.569,0.420],[0.310,0.663,0.502]] green
[[0.800,0.604,0.244],[0.851,0.706,0.369]] amber
[[0.761,0.376,0.306],[0.839,0.478,0.408]] danger
[[0.980,0.941,0.859],[0.200,0.161,0.039]] amberSoft
[[0.980,0.894,0.878],[0.227,0.094,0.071]] dangerSoft
[[0.863,0.941,0.902],[0.059,0.200,0.133]] greenSoft
[[0.451,0.365,0.714],[0.588,0.514,0.839]] purple
[[0.906,0.890,0.965],[0.141,0.110,0.227]] purpleSoft
[[1,1,1],[0.071,0.220,0.235]] white→dark surface
```
Aplicar em `fills` e `strokes` (SOLID e stops de GRADIENT).

---

## 3. `use_figma` — gotchas obrigatórios (custaram iterações)

- **Sempre** `await figma.setCurrentPageAsync(page)` **ou** `await page.loadAsync()` antes de ler `.children` (documento dynamic-page). `getNodeById` cross-page exige a página carregada.
- **Texto:** não existe `node.fontWeight`. Use `t.fontName={family:'Inter',style:'Semi Bold'}` e `figma.loadFontAsync` antes. Map peso→estilo: 400 Regular · 500 Medium · 600 Semi Bold · 700 Bold. Fraunces: `{family:'Fraunces',style:'Italic'}`.
- **Auto-layout:** definir `layoutMode` e **depois** `resize()`; setar `layoutSizingHorizontal/Vertical='FILL'` **só após** `appendChild`. `FILL`/`HUG` só em filhos de auto-layout. Em TEXT, `FILL` dá erro → usar largura fixa + `textAutoResize='HEIGHT'`.
- **ABSOLUTE:** `node.layoutPositioning='ABSOLUTE'` só se o pai tiver `layoutMode !== 'NONE'`. Se o pai é NONE, apenas setar `x`/`y`.
- **Reactions:** `node.reactions=[{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId,navigation:'NAVIGATE',transition:null,preserveScrollPosition:false,resetVideoPosition:false,resetScrollPosition:false,resetInteractiveComponents:false}]}]`. Plural `actions`. `transition:null`. **Sempre em try/catch** (nós TEXT e self-nav lançam). **Self-nav** (para o próprio top-level frame) é rejeitado. **NAVIGATE cross-page é rejeitado** (só funciona entre frames da MESMA página).
- **Effects:** shadows precisam `blendMode:'NORMAL'`. Tipos: BACKGROUND_BLUR, LAYER_BLUR, DROP_SHADOW, INNER_SHADOW.
- `clone()` cria na mesma página do original; `appendChild` move. `rescale(fator)` escala.
- `counterAxisAlignItems` = MIN/MAX/CENTER/BASELINE. `layoutGrow` inteiro.

---

## 4. ✅ Já concluído (sessões recentes 6–8, resumo)
- Tarefas unificada (Quadro/Tabela/Calendário/Detalhe) + Modal Documento + Modal Config Atributos.
- 3 páginas L↔D com todas as telas, darkify sem mistura, toggles wired.
- Auth (Login/Recuperar/Sucesso/404) reconstruído em **light glass** e diluído.
- Sidebar admin lightificada nos SOURCES (sessão 7).
- Landing longa completa (slider, números, cases, depoimentos).
- Quem somos (C-level + métricas + bússola).
- Header cliente padronizado (ícone bússola 1º + toggle entre menu e avatar), propagado; Menu Bússola claro `434:2` criado; Cliente L↔D refeito.

---

## 5. ✅ CONCLUÍDO NA SESSÃO 9 — última tarefa executada ao reconectar

> Requisição do usuário (verbatim resumido). Executada na sessão 9; mantida abaixo como checklist histórico do que foi tratado.

### 5.1 Sidebars erradas na página **North · Admin | L↔D** (`365:2`)
"Mais de 4 telas com sidebar errada. Refaça sidebar noturna nas telas noturnas e clara nas claras. Algumas estão certas, outras erradas — corrigir as últimas."
- **Causa provável:** a Admin L↔D foi construída na sessão 6, **antes** de lightificar as sidebars (sessão 7). Os clones estão desatualizados.
- **Correção:** **refazer a página Admin L↔D** clonando os SOURCES atuais de `295:2` (que já têm sidebar clara) + `darkify` nos clones escuros (o mapa transforma a sidebar clara → petróleo corretamente). Incluir: `295:3, 297:2, 299:2, 299:133, 323:2, 311:2, 336:15, 358:2, 358:72, 358:142, 374:2, 375:2, 375:65` (NÃO incluir `252:2`). Layout: claro x=0, escuro x=largura+120, rótulos ☀/🌙, título. Depois re-adicionar toggles (ver 5.3) e wire claro↔escuro.

### 5.2 **Admin · Tarefas · Quadro** (`358:2`) — refatorar Kanban
- **Sidebar errada:** mesma correção de tema (fica correta via 5.1 no L↔D; no SOURCE, garantir sidebar clara).
- **Kanban quebrado:** repensar os **cards** — mais design, encaixe perfeito, **sem quebra de página, sem cortes**. Cards com **altura fixa** por conteúdo (nada de `clipsContent` cortando texto), colunas com `layoutSizingVertical` coerente, espaçamento uniforme. Evitar cards saindo do frame.
- **Filtros superiores (`FilterBar`):** dar **border-radius**, deixar clean e bem encaixado (chips arredondados, espaçamento consistente, alinhados à direita a busca).
- **Verificar os mesmos erros em `Admin · Tarefas · Detalhe` (`358:142`)** e corrigir (cards do mini-board + painel lateral).

### 5.3 Toggle de tema → **dentro da sidebar** (admin não tem header)
- **Remover** o `ThemeToggle` do canto superior direito do conteúdo nas telas admin (foi colocado lá nas sessões 6/8).
- **Colocar** um ícone pequeno (☾/☀) **ao lado do "north"/logo, no topo da sidebar, canto superior direito da sidebar**, encaixado dinamicamente e **centralizado verticalmente com o wordmark**. Aplicar em todos os frames admin (incl. os 3 L↔D via clone).

### 5.4 Telas de **card por tipo de tarefa** (estilo `Modal · Documento` `375:2`) + **Nova Tarefa**
Criar modais de detalhe por tipo, com atributos (definição adotada — não havia spec no `REGRAS-DE-NEGOCIO-PORTAL-NORTH.md`):
- **Criativo:** Formato (Reels/Post/Story/Carrossel) · Plataforma (Instagram/TikTok/YouTube) · Roteiro · Referências · Responsável (editor/designer) · Prazo · Status · Aprovação · Anexos.
- **Agendamento:** Data/hora de publicação · Plataforma · Legenda/Copy · Hashtags · Link · Status (agendado/publicado) · Responsável.
- **Desempenho:** Métrica · Meta · Valor atual · Período · Variação % · Fonte de dados · Responsável.
- Criar também a **tela de criação de tarefa** ("Nova Tarefa") — seletor de tipo + campos conforme o tipo.
- Reusar layout/estilo do `Modal · Documento` (backdrop petrol 55%, card branco 16r, header ícone+título+✕, corpo em grade de atributos, rodapé com ações).

### 5.5 **Modal · Config Atributos** (`375:65`)
- **Corrigir formatação/alinhamento do "tipo do atributo"** (a pílula de tipo está desalinhada nas linhas).
- **Ícone de cadeado** nos atributos **essenciais** — e **cada tipo de card trava atributos diferentes** (ex.: Desempenho trava Métrica/Meta/Período; Agendamento trava Data/Plataforma; Criativo trava Formato/Plataforma/Responsável). Mostrar cadeado nesses.

### 5.6 **Prototype end-to-end**
Ligar todas as telas novas (modais por tipo, Nova Tarefa) aos gatilhos (cards do Quadro/Tabela/Calendário → modal do tipo; "+ Nova tarefa" → criação; ✕ volta). Lembrar: NAVIGATE só na mesma página.

### 5.7 **Teste de travessia do protótipo (as 3 páginas)**
"Escreva um teste que começa na primeira página usando o protótipo, começando no primeiro card e terminando no último. Se falhar antes, ainda existem páginas não indexadas no protótipo. **Faça para as 3 páginas.**"
- Implementar como script `use_figma` que, por página, parte do 1º frame/card, segue as `reactions` (NAVIGATE) nó a nó, e verifica que consegue alcançar o último. Reportar qualquer nó sem reaction de saída = "página não indexada". Rodar para as 3 páginas L↔D (Admin, Cliente, Landing) — ou para as SOURCE, conforme fizer sentido para o fluxo.

---

## 6. Primeiro passo ao reabrir
1. Confirmar Figma MCP ativo.
2. Screenshot de `358:2` (Quadro) e da página `365:2` (Admin L↔D) para ver o estado real das sidebars/cards antes de editar.
3. Executar 5.1 → 5.7 em ordem, validando por `get_screenshot` a cada etapa.
4. Ao terminar, atualizar `memory/north-saas-figma.md` (sessão 9) e este doc.
