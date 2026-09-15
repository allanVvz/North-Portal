# Revisão de storytelling, hierarquia e visualização — relatórios de anúncios e resultados

Data: 2026-09-15. Estado analisado: commit `6a7e1d9` (modelo v2).
Nenhum código foi alterado nesta etapa.

## 0. Base, premissas e skills

**Fontes lidas**
- Código: `lib/reports/adsReportPdf.tsx`, `salesReportPdf.tsx`, `reportBlocks.tsx`,
  `adsInsights.ts`, `conversionFocus.ts`, `conversionMode.ts`, `salesHeadline.ts`,
  `lib/automations/run.ts`, `conversionFlow.ts`, `reportEntities.ts`, `lib/metaInsights.ts`.
- PDFs gerados (simulação de 15/09, mídia real do Meta): `Downloads/north-relatorios-simulados/`
  — Baita (foco em seguidores) e CRIS CAR CARE (foco em vendas), semanas 02–08/09 e 09–15/09.
- Referências: `_Métricas - CRIS CAR CARE 2906.pdf` (relatório manual da equipe, 5 páginas),
  `relatorio-vendas-EXEMPLO-completo.pdf` (layout anterior), `modelo-relatorios-north-v2.html`.
- Sonda de leitura na API do Meta (anúncios reais da CRIS e da Baita) para previews.

**Correção de premissa.** A geração não é Python: é TypeScript/React com
`@react-pdf/renderer`, dentro do Next.js. Tudo o que o briefing descreve em Python vale
para essa stack.

**Skills pedidas × disponíveis**

| Skill | Situação | Como foi usada |
|---|---|---|
| `dashboard-designer` | instalada (`.claude/skills/dashboard-designer`) | Passada 1 |
| `data-visualization` | **não existe** no projeto nem no ambiente | Passada 2 feita sem a skill, complementada pela base de gráficos do `ui-ux-pro-max` (declarado) |
| `dataviz` | disponível (skill do ambiente) | Passada 3, com o validador de paleta rodado |
| `ui-design-pro` | **não existe** | Passada 4 com `ui-ux-pro-max` como substituta **declarada** |

Nenhuma substituição foi silenciosa.

**Dados disponíveis (verificado)**
- Campanha e anúncio trazem: investimento, alcance, impressões, cliques, cliques no link,
  CTR, CPC, CPM, frequência, visualizações da página de destino, visitas ao perfil,
  conversas, engajamento, curtidas, salvos, compartilhamentos, visualizações de vídeo.
  **Hoje o PDF usa uma fração disso** (sem impressões, CTR, frequência, landing views).
- Feedback (comentário): vendas, agendamentos, receita, seguidores (total), linhas de venda
  com origem #1/#2/#3.
- Série: `task_metrics` por `period_to` (conversão) e `traffic_reports.snapshot` (mídia por
  revisão). A API do Meta também devolve semanas anteriores sob demanda.

---

## PASSADA 1 — dashboard-designer

Enquadramento da skill: audiência → decisão → frequência → arquétipo → níveis de KPI →
padrão de leitura (F) → títulos como insight → todo KPI com comparação.

### Audiência e decisão

| | Relatório 1 — Anúncios | Relatório 2 — Resultados |
|---|---|---|
| Quem lê | gestor de tráfego (decide) + cliente (acompanha) | dono do negócio |
| Decisão | onde a verba rende, quais criativos escalar/rever | a mídia está valendo? o negócio cresceu? |
| Arquétipo | **operacional com camada executiva** — 4–6 KPIs de manchete, detalhe completo abaixo | **estratégico adaptativo** — 1 figura principal, 3–5 de apoio, detalhe conforme o feedback |

### Arquitetura da informação atual

**Relatório 1** — cabeçalho → faixa de 5 KPIs → 1 frase + 2 cartões → funil (3 etapas) com
pilha lateral → painéis por objetivo (máx. 2) → até 3 destaques + tabela de 6 criativos.
Uma página.

**Relatório 2** — cabeçalho → faixa de KPIs → frase + 2 cartões → nota "não informado" →
funil completo + pilha + nota de fontes → eficiência + origem → histórico → (quebra) mídia →
criativos → vendas descritas. 1 página (seguidores) ou 2 (vendas).

### Achados

1. **O primeiro olhar funciona; o segundo não explica.** A faixa de KPIs responde "o que
   aconteceu". Mas os cartões seguintes respondem com mais números em vez de "por quê".
   Na CRIS: "62,21% Tráfego · 37,79% Engajamento" e "21,74% Tráfego · 78,26% Engajamento" são
   dois cartões para o que é **uma** conclusão — *Engajamento concentrou o resultado: 38% da
   verba, 78% das conversas.*
2. **A hierarquia não muda com o modo; só os números mudam.** Seguidores e vendas usam a
   mesma grade (faixa → leitura → funil → pilha). O briefing pede que a importância visual
   mude: no modo seguidores, o crescimento do perfil deveria dominar a página inteira; hoje ele
   é o primeiro de quatro cartões iguais.
3. **Os títulos de seção são rótulos, não afirmações.** "Performance da semana",
   "Funil de aquisição", "Criativos em destaque". A skill pede o título como insight.
4. **A comparação por objetivo perdeu força.** Os painéis lado a lado usam conjuntos de
   métricas **diferentes** por objetivo (Tráfego tem "Cliques no site"; Engajamento tem
   "Interações") — as linhas não se alinham, então a comparação horizontal que motivou os
   painéis não acontece. E há corte em 2 objetivos.
5. **Seções que cresceriam ficaram presas a limites de uma folha.** Criativos em 6 linhas,
   objetivos em 2 painéis, vendas descritas em 10 linhas. O briefing libera 2–3 páginas.
6. **"Não informado no feedback da semana: receita, vendas, agendamentos."** transforma
   ausência em conteúdo no modo seguidores.

### Recomendações da passada

- Relatório 1: manchete analítica + faixa → funil → **tabela comparativa de objetivos** (linhas
  alinhadas) → criativos com protagonismo → tendência quando houver.
- Relatório 2: **hierarquia por modo** (seção 5 do plano), não um template com slots trocados.
- Títulos de seção como frase curta quando houver conclusão ("Engajamento concentrou as
  conversas"); rótulo neutro só quando não houver.
- "5-second test": figura principal + manchete de uma linha.

---

## PASSADA 2 — data-visualization *(skill ausente; feita sem ela)*

Complementada com a base `charts.csv` do `ui-ux-pro-max` (funil: 3–8 etapas, % entre etapas,
destacar a maior queda; comparação de categorias: barra ordenada; tendência: linha, **menos de
4 pontos → cartão numérico**).

### Funil
- **Larguras fixas 100%→42%**, independentes do valor. Legível, mas não proporcional: 16.429 e
  23 têm a mesma diferença visual que 474 e 23. O briefing pede proporcional **e** legível.
- **Omitido** quando há menos de 2 etapas ou quando o template esconde "funnel". O briefing
  pede funil **sempre**.
- Relatório 1 não usa "visitas" (perfil ou página de destino), que existem na API.
- Relatório 2 (seguidores) mostra "seguidores novos = 6,58% das visitas" — taxa entre fontes
  diferentes, frágil; o briefing a dispensa.
- Não há a etapa-base "total do perfil" pedida para seguidores.

### Tabelas
- Criativos: 6 colunas (leitura, criativo, alcance, cliques, conversas, investimento). **Sem
  impressões, CTR, custo por resultado** — justamente o que responde "qual criativo é eficiente".
- Vendas descritas: correta; cabe crescer.
- Não existe tabela de objetivos com linhas alinhadas.

### Rankings e criativos
- Classificação em 4 rótulos (Mais conversas / Mais cliques / Revisar / Estável). Na Baita,
  **4 de 5 linhas saem "— Estável"** — rótulo sem conteúdo analítico.
- Um criativo só pode receber um rótulo; "melhor CTR", "maior gasto", "mais eficiente",
  "tráfego sem conversão" não existem.

### Comparações temporais e histórico
- Histórico em colunas com **2 pontos**. Para seguidores as colunas de total (1.214 e 1.251)
  começam do zero e ficam visualmente iguais — **o crescimento, que é a história, some**.
- Não há tendência de mídia (a API tem as semanas anteriores).

### Distribuição de verba e participação por objetivo
- Hoje em texto ("62,21% Tráfego · 37,79% Engajamento"). A forma certa é **barra de
  parte-do-todo pareada**: verba × resultado por objetivo, lado a lado — mostra concentração
  sem frase.

### Conversões, vendas segmentadas e origem
- Eficiência comercial (62,5%) e escada de custo (R$ 8,04 / 23,11 / 36,98) são bons.
- Origem por fonte em lista de texto; com 3 fontes, barra horizontal ordenada com
  "sem origem" em cinza mostraria cobertura sem nota explicativa.

### Seguidores
- Faltam: evolução acumulada, total do perfil como base visual, ganho semanal como série
  própria (não confundir com total).

---

## PASSADA 3 — dataviz

Procedimento da skill aplicado: forma → cor por função → **validador** → marcas → leitura.

### Forma (choosing-a-form)
| Hoje | Diagnóstico | Forma certa |
|---|---|---|
| Histórico de 2 pontos em colunas | anti-padrão "one-bar/two-bar chart" | **figura com seta** "1.214 → 1.251" (stat tile) |
| Totais de seguidores em colunas desde zero | esconde a mudança | **linha** a partir de 3 pontos, rótulos só nas pontas |
| Verba e conversas por objetivo em texto | parte-do-todo sem forma | **barra empilhada horizontal pareada** |
| Criativos: 3 cartões de peso igual | categórico quando a história é "um explica a semana" | **ênfase**: 1 destaque grande + demais neutros |
| Objetivo semana a semana | ausente | **dumbbell** (antes → depois) por objetivo |

### Cor — validador rodado
`node scripts/validate_palette.js "#4a857c,#3c6285,#8a6d2f,#6a5a82" --mode light`:
- ✅ faixa de luminosidade, ✅ separação CVD (ΔE 11,4), ✅ contraste
- ❌ **piso de croma** — as 4 cores leem como cinza
- ❌ **piso de visão normal** — teal × azul ΔE **11,6 < 15**: o par "Agendamentos × Vendas"
  do histórico atual é difícil de distinguir mesmo com visão plena.

Consequência: séries que têm **ordem** (agendamento → venda) devem usar **uma matiz em dois
tons** (rampa ordinal), não duas categóricas. Categórico só onde a identidade importa
(objetivos), e com rótulo direto.

### Marcas e anatomia
- Barras hoje com `rx` uniforme; a skill pede cantos arredondados só na ponta do dado, base
  reta, gap de 2pt entre barras adjacentes.
- **Figura principal em serif (Fraunces)** é anti-padrão catalogado ("display/serif face on
  the hero figure"). É também a identidade da marca na tela de Performance — **decisão
  pendente** (ver plano §11).
- Tabelas sem `tabular-nums`: colunas de números não alinham.
- Texto nunca na cor da série — hoje respeitado.

### Storytelling visual
- A relação dado ↔ narrativa é fraca: as frases repetem números que o gráfico ao lado já
  mostra ("Alcance ↓ 38,77% · conversas ↓ 11,54% · custo por conversa ↓ 10,31%").
- Faltam âncoras editoriais: um número grande que abre, uma afirmação que o explica, um
  gráfico que prova.
- Whitespace de fim de página vem de `wrap={false}` + quebra forçada, não de intenção.

---

## PASSADA 4 — ui-design-pro *(substituta declarada: ui-ux-pro-max)*

Regras aplicadas: `visual-hierarchy` (tamanho/espaço antes de cor), `font-scale`,
`spacing-scale` 4/8, `number-tabular`, `whitespace-balance`, `color-not-only`,
`direct-labeling`, `truncation-strategy`, `image-dimension`.

### Tipografia
- Escala atual: 5,4 / 5,6 / 5,7 / 5,8 / 5,9 / 6,1 / 6,2 / 6,4 / 6,6 / 7,3 / 8 / 8,6 / 11 /
  12,5 / 13,5 / 17 / 19 pt — **17 tamanhos**, vários abaixo do legível impresso ou no celular
  (rótulos a 5,4–5,8 pt ≈ 7–8 px).
- Proposta: escala de 6 degraus — 6,5 (rótulo) · 7,5 (corpo) · 9 (análise) · 12 (subtítulo) ·
  20 (figura de seção) · 30 (figura principal).

### Grid e espaçamento
- Paddings e gaps arbitrários (3, 3,5, 5, 6, 7, 8, 11, 12). Proposta: ritmo de 4 pt
  (4 / 8 / 12 / 16 / 24 / 32).
- Largura útil A4 ≈ 531 pt. Grid de 12 colunas: componentes ocupam 12 (largura total),
  6 (metade), 4 (terço) ou 8+4.

### Cards, tabelas, funil
- Cards todos com a mesma borda e raio → peso igual. Proposta: 3 níveis de superfície
  (destaque com fundo suave, cartão com borda, célula sem borda).
- Tabelas sem zebra, sem alinhamento tabular, sem linha de destaque para o item com rótulo.
- Funil: rótulo em 5,4 pt branco dentro do trapézio — no limite de contraste e tamanho.

### Previews
- `image-dimension`: miniatura precisa de caixa fixa 1:1 reservada, com placeholder quando
  faltar, para não quebrar a grade.

### Curto × longo
- Hoje o componente tem tamanho fixo e a página se ajusta cortando. Proposta: componentes com
  tamanho mínimo/ideal e largura em colunas; a página flui.

---

## Consolidação

### 1. Relatório 1 — avaliação atual
**Bom:** faixa executiva; investimento sem cor de julgamento; funil presente; leitura
"visitas ao perfil" para contas sem conversa; métrica técnica só quando crítica.
**Fraco:** frase-manchete que descreve perdas quando a eficiência melhorou; cartões de
participação que são informação, não análise; comparação por objetivo desalinhada e cortada
em 2; criativos presos a 6 linhas, sem CTR, impressões e custo por resultado, com "Estável"
como rótulo dominante; sem previews; sem tendência.

Caso concreto (CRIS, 09–15/09 × 02–08/09): investimento **−20,7%**, conversas **−11,5%**, custo
por conversa **−10,3%** (melhorou). A manchete atual é *"A mídia perdeu alcance e as conversas
também caíram."* A leitura justa é *"Com 21% menos investimento, a operação manteve 23
conversas a um custo 10% menor."* — o motivo é a ordem das regras em
`adsInsights.mediaNarrative`, que não considera variação de investimento.

### 2. Relatório 2 — avaliação atual
**Bom:** foco na conversão principal; ausência ≠ zero; eficiência comercial; origem com
cobertura; custo de mídia por etapa.
**Fraco:** notas metodológicas em 5 lugares; hierarquia idêntica entre modos; mídia
reapresentada com o rótulo "mesmos dados do relatório 1"; histórico de 2 pontos como gráfico;
criativos que "explicam a semana" sem relação com a conversão principal.

### 3. Modo followers_only
Hoje parece um relatório de vendas sem vendas: faixa de 4 cartões iguais, nota de ausência,
funil com taxa frágil, histórico de colunas iguais, mídia e criativos genéricos.
Precisa virar um **relatório de crescimento de audiência**: figura grande "+37 seguidores",
"de 1.214 para 1.251 (+3,05%)", funil alcance → visitas ao perfil → seguidores novos → total do
perfil, evolução acumulada, criativo que mais levou ao perfil com preview.

### 4. Problemas de storytelling
- Frases que listam números (`mediaNarrative.body`, `followersNarrative.body`).
- Manchete que ignora eficiência relativa (caso CRIS acima).
- Participações apresentadas separadas em vez de relacionadas (verba × resultado).
- Alerta técnico dominando resultado saudável: "CPE +305%" ocupa o cartão de atenção enquanto
  Engajamento entregou 78% das conversas.
- Nenhuma frase sobre criativo que explica a semana ("ad promos agosto concentrou 78% das
  conversas").
- Metalinguagem no PDF (inventário em §9).

### 5. Problemas de hierarquia
- Figura principal com o mesmo tamanho dos KPIs vizinhos (17 pt × 13,5 pt).
- Modos sem hierarquia própria.
- Seções de detalhe (tabelas) com o mesmo peso de título que seções de conclusão.

### 6. Problemas de visualização
Funil não proporcional e às vezes ausente; histórico de 2 pontos em gráfico; totais em colunas
desde zero; paleta reprovada no validador; verba/resultado por objetivo em texto; origem em
lista; tabelas sem alinhamento tabular.

### 7. Problemas de criativos
Limite de 6 linhas; métricas incompletas; um rótulo por criativo; "Estável" sem sentido;
nenhum preview; "Revisar" que ainda depende de regras rígidas; ausência de "maior gasto",
"melhor CTR", "mais eficiente", "tráfego sem conversão", "explica a mudança".

### 8. Oportunidades para previews (verificado na API)
| Campo | Resultado real (CRIS e Baita, 8 anúncios) |
|---|---|
| `creative.thumbnail_url` (padrão) | 64×64 px — inutilizável |
| `creative.image_url` | **vazio** em todos (anúncios são vídeo ou post compartilhado) |
| nó do criativo com `thumbnail_width=600&thumbnail_height=600` | **600×600 JPEG, 33–52 KB** ✅ |
| `creative.object_type` | `VIDEO` ou `SHARE` (carrossel/post) |
| `video_id`, `effective_object_story_id` | presentes |
| `instagram_permalink_url` | presente (link do post) |

Viável. Restrições: URL assinada do Facebook expira em dias → **baixar na geração e
guardar no storage**; uma chamada extra por lote de criativos; o renderer lê o arquivo local.

### 9. Componentes redundantes / metalinguagem
Não é redundância numérica — repetir um número em resumo, funil e tabela é aceitável quando
cada lugar responde algo diferente. O problema é **texto sobre o sistema**:

| Texto no PDF | Onde |
|---|---|
| "leitura agregada de todas as campanhas" | funil R1 |
| "comparação direta" | objetivos R1 |
| "leitura por regra" · "destaques por regra" | criativos R1 e R2 |
| "Custos unitários (…) só aparecem quando pioraram de forma relevante…" | nota R1 |
| "jornada agregada — mídia + feedback" | funil R2 |
| "… vêm da mídia; … vêm do feedback e incluem todos os canais — as proporções … são indicativas." | nota R2 |
| "Não informado no feedback da semana: …" | R2 |
| "mesmos dados do relatório 1, com menos peso" | mídia R2 |
| "Origem e receita por fonte aparecem só quando informadas no feedback…" | origem R2 |
| "… — inclui outros canais" · "… não só o que veio de anúncio" · "… inclui quem chegou sem anúncio" | 3 cartões R2 |
| "Relatório 2 · origem, receita por fonte … só aparecem quando informados no feedback" | rodapé R2 |

Todas essas cinco notas sobre canais viram **uma** linha discreta de rodapé.

### 10. Componentes que precisam crescer
Tabela comparativa por objetivo · criativos (destaques com preview + tabela completa) ·
funil (proporcional, com mais etapas quando houver dado) · figura principal do R2 ·
bloco de crescimento de audiência · histórico de seguidores (evolução acumulada) · vendas
descritas (sem limite de 10).

### 11. Componentes que precisam diminuir
Pilha lateral do funil (3 cartões → 1–2 números que o funil não mostra) · cartões de
participação (viram 1 frase + 1 barra) · notas metodológicas (5 → 1 no rodapé) · alerta
técnico quando o resultado está saudável (vira destaque vermelho na tabela) · mídia no R2
(vira tabela compacta por objetivo, sem painel duplicado) · histórico de 2 pontos (vira
figura com seta).
