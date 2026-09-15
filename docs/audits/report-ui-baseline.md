# Baseline de UI — os dois relatórios em PDF

Data: 2026-09-15. Avaliação feita sobre PDFs **reais de produção** (CRIS CAR CARE,
semana de 05/09 a 11/09), abertos e lidos na tela, não sobre mocks.

> **Sobre as skills.** O briefing pedia quatro passadas usando `dashboard-designer`,
> `data-visualization`, `dataviz` e `ui-design-pro`. **Nenhuma das quatro existe** —
> nem instalada nem no catálogo de plugins oficial. As quatro passadas abaixo foram
> feitas por mim, mantendo os mesmos eixos de avaliação. Nada foi substituído em
> silêncio. O pacote instalado no repo (`ui-ux-pro-max-skill`) cobre design system e
> tipografia, não arquitetura de informação de relatório.

> **Estado no momento da avaliação.** O relatório de **vendas** foi redesenhado em
> 15/09 (commit `78f1359`): frase de abertura, resumo sem investimento, funil no topo,
> uma folha só. O de **tráfego** está como sempre esteve. Por isso os dois baselines
> não estão no mesmo ponto de partida — e vários problemas do tráfego são exatamente os
> que acabaram de ser corrigidos no de vendas.

---

# Relatório 1 — Anúncios / Tráfego

Pergunta que deveria responder: **"Como a mídia performou nesta semana?"**

Ordem atual: Resultados por campanha (12 cartões) → Criativos (3 tabelas) → Eficiência
de mídia → Visão geral / Funil de aquisição.

## Passada 1 — Arquitetura da informação

**Problemas**

- **CRÍTICA — não existe resumo executivo.** O documento abre direto em "Resultados por
  campanha › Tráfego para o site". Não há em lugar nenhum o número da semana:
  investimento total, alcance total, conversas, custo por conversa. Quem recebe precisa
  somar dois blocos de cabeça para saber quanto gastou.
- **ALTA — o funil está por último.** É a peça que se lê sem legenda e está depois de
  três tabelas de criativo. Mesmo erro que o relatório de vendas tinha e que foi
  corrigido ontem.
- **ALTA — nenhuma frase de diagnóstico.** 100% número, zero leitura. Nada diz se a
  semana foi boa.
- **MÉDIA — hierarquia plana entre "por campanha" e "geral".** Os blocos por objetivo
  vêm antes do consolidado, invertendo do específico para o geral.

**Pontos positivos**

- Separar por objetivo (Tráfego / Engajamento) é a divisão certa — cada objetivo tem
  métrica de sucesso diferente e misturá-los mentiria na média.
- O funil já respeita o escopo: termina em conversas, não invade agendamento/venda.
- Etapa sem dado sai do funil em qualquer posição (`adsReportPdf.tsx:150-157`), em vez
  de virar faixa vazia.

## Passada 2 — Dataviz

**Problemas**

- **ALTA — 12 cartões com peso visual idêntico** (6 por objetivo). É comparação
  pareada (Tráfego × Engajamento) desenhada como duas listas independentes: para
  responder "qual objetivo trouxe mais mensagens por real?" o leitor tem que saltar
  entre dois blocos e comparar de memória. É o caso clássico de **matriz**, não de
  cartão.
- **CRÍTICA — semântica de cor em investimento.** O cartão de Investimento herda
  `metricRefInverse` (`performanceLabels.ts:101`), que classifica `custo` como "menor é
  melhor". Investimento é **neutro**: gastar menos não é vitória, e gastar mais não é
  derrota. O relatório emite julgamento onde não há.
- **MÉDIA — a tabela de criativos é administrativa, não analítica.** 7 colunas, nenhum
  destaque. O melhor e o pior criativo estão lá, mas o leitor precisa comparar 7 números
  em 7 linhas para achá-los.
- **MÉDIA — coluna "#" morta.** É o `adSourceTag` do criativo (`adsReportPdf.tsx:206`);
  sem tags configuradas — o caso da CRIS CAR CARE — a coluna inteira é "—".

**Pontos positivos**

- Números em formato pt-BR consistente e com abreviação sensata ("3,3 mil").
- Cap explícito (6 campanhas, 3 criativos) evita relatório infinito, com nota de
  overflow.

## Passada 3 — Direção visual

**Problemas**

- **MÉDIA — card soup.** Toda informação é um retângulo com borda e raio. O acento
  verde no topo de cada cartão repete 12 vezes e deixa de significar qualquer coisa.
- **BAIXA — whitespace não intencional** entre os blocos por objetivo e a seção de
  criativos.

**Pontos positivos**

- Paleta sóbria, verde dessaturado, fundo claro, alto contraste — a família visual já
  é a certa, e é a mesma dos dois relatórios.
- Tipografia com numerais bem legíveis em tamanho grande.

## Passada 4 — Polish

- **MÉDIA — datas em dois formatos no mesmo subtítulo**: `2026-09-05 a 2026-09-11 ·
  gerado em 11/09/2026` (`adsReportPdf.tsx:163`). Já corrigido no de vendas, pendente
  aqui.
- **BAIXA — "vs. anterior" repetido 12 vezes** sem nunca dizer qual é o período
  anterior. Mesma correção já aplicada no de vendas (legenda única).
- **BAIXA — tracking alto nos kickers uppercase** em fonte de 6,6px.

---

# Relatório 2 — Vendas / Conversão

Pergunta que deveria responder: **"O que a mídia virou em resultado para o negócio?"**

Ordem atual (pós-redesenho): frase → resumo (6 KPIs) → funil → como a mídia performou →
fonte de tráfego → vendas detalhadas.

## Passada 1 — Arquitetura da informação

**Problemas**

- **CRÍTICA — ausência tratada como zero.** O layout é fixo: pede sempre as mesmas
  métricas. Um cliente que só informe "+12 seguidores" recebe um relatório com vendas,
  receita e ROAS zerados como se a semana tivesse ido mal. Ver A4 na auditoria de fluxo.
- **CRÍTICA — ainda duplica o relatório 1.** A seção "Como a mídia performou" é o mesmo
  `CampaignBlocksSection`, com os mesmos 12 cartões. O relatório 1 já respondeu isso;
  aqui a mídia deveria ser só contexto do resultado.
- **ALTA — o funil refaz aquisição.** Alcance → Cliques → Conversas → Agendamentos →
  Vendas atravessa as duas pipelines e sugere atribuição ponta a ponta que o dado não
  sustenta. O funil deste documento é comercial: Conversas → Agendamentos → Vendas.
- **ALTA — não existe estado de cobertura de atribuição.** Se as 5 vendas não têm
  origem, a tabela some e o leitor não sabe se não houve venda ou se não houve
  atribuição.

**Pontos positivos**

- A frase de abertura resolve o nível de 5 segundos, é determinística e associa cada
  percentual à sua métrica.
- A ordem do resumo (receita → vendas → agendamentos) já é a do dono do negócio, e o
  investimento saiu de lá.
- A legenda única diz com qual período real a comparação foi feita.

## Passada 2 — Dataviz

**Problemas**

- **ALTA — o funil pode alargar no meio** quando há atribuição parcial (mitigado ontem
  para seguidores, mas a regra é pontual, não geral).
- **MÉDIA — a tabela "Fonte de tráfego e objetivo" nasce com uma linha só** ("Sem tag /
  Vários") quando não há tags. Oito colunas para uma linha sem informação.

**Pontos positivos**

- Seguidores comparado em absoluto (+12), não em percentual.
- Precedência explícita entre total relatado e soma das linhas detalhadas, com nota
  quando divergem.

## Passada 3 — Direção visual

- **ALTA — os dois documentos são visualmente quase o mesmo.** Compartilham a família
  (correto) *e* a estrutura (errado): mesmos blocos, mesma grade, mesmo funil. Lado a
  lado, o segundo parece "o primeiro com vendas no topo".
- Positivo: uma folha só, densidade útil alta, whitespace agora intencional.

## Passada 4 — Polish

- **MÉDIA — o painel de resultado do funil** ocupa um retângulo verde grande à direita
  repetindo "5 vendas", número que já domina o resumo. Espaço nobre para informação
  repetida.
- **BAIXA — "Retorno sobre o anúncio"** é mais claro que "ROI (ROAS)", mas o `hint`
  ("sobre R$ 222,73 investidos") compete com o delta na mesma altura.

---

# Prioridades consolidadas

| Prioridade | Item | Relatório |
|---|---|---|
| CRÍTICA | Ausência ≠ zero, ponta a ponta | 2 |
| CRÍTICA | Parar de duplicar mídia e funil de aquisição | 2 |
| CRÍTICA | Investimento como variável neutra | 1 |
| ALTA | Resumo executivo no topo | 1 |
| ALTA | Cobertura de atribuição explícita | 2 |
| ALTA | Matriz Tráfego × Engajamento no lugar dos 12 cartões | 1 |
| ALTA | Funil para o topo | 1 |
| MÉDIA | Criativos com estados calculados (TOP / ATENÇÃO) | 1 |
| MÉDIA | Datas pt-BR + legenda única do comparativo | 1 |
| MÉDIA | Coluna "#" some sem tags configuradas | 1 |
| BAIXA | Frase de diagnóstico determinística | 1 |

Esta rodada implementa as três CRÍTICAS do relatório 2 e a CRÍTICA do relatório 1; o
resto está registrado em `docs/reporting/report-pipeline.md` como backlog priorizado.
