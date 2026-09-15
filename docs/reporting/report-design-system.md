# Sistema de design dos relatórios em PDF

Os dois relatórios compartilham a **família visual** e **não** compartilham a
**estrutura**. Lado a lado, o de vendas não pode parecer "o de anúncios com vendas no
topo".

Implementação: `@react-pdf/renderer`. Tokens em `lib/reports/reportTheme.ts`, estilos e
componentes em `lib/reports/reportComponents.tsx`.

> As quatro skills de UX pedidas para esta revisão não existem no ambiente. As regras
> abaixo vêm da leitura dos PDFs reais de produção (`docs/audits/report-ui-baseline.md`).

---

## Modelo v2 (15/09) — o que vale hoje

Baseado no modelo `modelo-relatorios-north-v2.html` e nas decisões do usuário. Onde este
bloco contradiz as seções mais abaixo, **este bloco vale**.

**Relatório 1 — anúncios** (`adsReportPdf.tsx`): performance da semana (5 números da
mídia inteira + leitura em uma frase) → funil de aquisição trapezoidal com a taxa entre
etapas → objetivos lado a lado → criativos com destaques por regra e tabela com coluna
"Leitura".

**Relatório 2 — resultados** (`salesReportPdf.tsx`): voltou a mostrar mídia E conversão,
mas **ancorado na conversão mais importante da jornada informada**
(`conversionFocus.focusOf`: venda/receita > agendamento > seguidor). Ela ganha o número
grande, a frase, o fim do funil e o histórico. Ordem: resultado da semana → funil
completo → eficiência comercial e origem → histórico → mídia com menos peso → criativos →
vendas descritas.

**Métrica técnica** (CPC, CPE, taxa de clique): só aparece quando é **crítica** (custo
unitário ≥ 30% pior que a semana anterior) e sempre com a frase que a explica ("cada
engajamento custou R$ 0,17 — 305% mais caro"). Fora disso o espaço dela é reaproveitado
por um número de leigo (parte da verba, parte das conversas). Regra em
`adsInsights.efficiencyOf`.

**Desfecho da mídia** (`adsInsights.mediaOutcome`): conversa quando a conta recebe ao
menos 3 na semana; senão visita ao perfil. Muda o destaque da faixa, o funil, a frase e a
regra de "Revisar" dos criativos — numa conta sem conversa, "sem gerar conversa" não é
defeito do criativo.

**Funil que cruza fontes**: taxa dita como proporção ("agendamentos = 34,78% das
conversas"), nunca como passagem, e uma nota lista quais etapas vêm da mídia e quais do
feedback.

**Sem repetição**: cada número aparece uma vez com destaque; faixa, cartões de leitura e
pilha lateral do funil trazem informações diferentes.

**Glifos**: valores em Fraunces não usam "→" nem "↑" (a fonte não tem os glifos); setas só
em texto Inter.

Módulos: `adsInsights.ts` e `conversionFocus.ts` (leitura, puros e testados),
`reportBlocks.tsx` (componentes visuais).

---

## Princípio de leitura em três níveis

1. **5 segundos** — a frase de abertura diz se a semana foi boa e o resultado principal.
2. **20 segundos** — os KPIs de nível 1 e o funil mostram onde melhorou ou piorou.
3. **Leitura detalhada** — tabelas de origem, criativos, vendas linha a linha.

Toda mudança responde: *isto torna a informação mais rápida, correta ou fácil?*

---

## Família visual (compartilhada)

- Fundo claro, texto de alto contraste, verde dessaturado como identidade.
- Uma folha A4 como alvo; página 2 só quando o detalhe realmente não cabe.
- Verde sólido só em elemento que merece destaque — não em cada cartão.
- Numerais grandes dominam; rótulos pequenos e discretos; metadado menor ainda.
- Datas sempre pt-BR (`05/09/2026`); nunca ISO no documento.

### Tipografia (estilos em `REPORT_STYLES`)

| Papel | Estilo |
|---|---|
| Título | `title` — Inter 700, 11,5 |
| Frase de abertura | `headline` — Inter 600, 8,6 |
| Kicker de seção | `kicker` — Inter 600, 6,6, uppercase |
| Valor de KPI | `kpiValue` |
| Linha de contexto em texto | `contextLine` — Inter 600, 8 |
| Legenda / nota | `legend` — 6,4, cor muted |

---

## Relatório 1 — Anúncios

Pergunta: **como a mídia performou?** Determinístico, sem IA.

Estrutura atual: resultados por campanha → criativos → eficiência → funil de aquisição.

Estrutura-alvo (pendente, ver `report-pipeline.md`):

1. Frase de diagnóstico determinística (ex.: "Conversas cresceram com custo por
   resultado estável").
2. Faixa executiva: investimento · alcance · cliques · conversas · custo por conversa.
3. Funil de aquisição **horizontal**, com a taxa ENTRE as etapas ("1,82% chegaram ao
   clique"). Termina em **conversa** — nunca agendamento/venda.
4. Matriz Tráfego × Engajamento (linhas = métrica, colunas = objetivo) no lugar dos 12
   cartões.
5. Criativos com estado calculado (TOP / FORTE / ESTÁVEL / ATENÇÃO).

## Relatório 2 — Vendas

Pergunta: **o que virou resultado para o negócio?** Modular.

Estrutura implementada:

1. Frase de abertura (`salesHeadline`) — cada percentual colado na sua métrica.
2. Resumo — só KPIs informados, na ordem de leitura do dono do negócio.
3. Nota "Não informado no feedback: …" quando alguma métrica faltou.
4. Funil **comercial**: conversas → agendamentos → vendas (só etapas existentes).
5. Contexto da mídia em uma linha: investimento · conversas · vendas relatadas.
6. Cobertura de atribuição, quando nem toda venda tem origem.
7. Fonte de tráfego × objetivo (só o que foi descrito com origem).
8. Vendas e agendamentos detalhados.

### Hierarquia de KPIs

| Nível | Métricas |
|---|---|
| 1 | receita · vendas · ROAS · custo por venda |
| 2 | agendamentos · ticket médio · conversão · seguidores ganhos |
| 3 | total de seguidores · metadado · operação |

---

## Regras condicionais (relatório 2)

| Condição | Renderiza | Não renderiza |
|---|---|---|
| receita informada | Receita | — |
| receita **e** vendas | Ticket médio | Ticket quando falta um dos dois |
| receita **e** investimento > 0 | Retorno sobre o anúncio (×) | ROAS `0,00` |
| seguidores informado | Seguidores + ganho absoluto | percentual de seguidores |
| só seguidores | resumo de audiência, frase de audiência | funil comercial, vendas, receita, ROAS |
| ≥ 2 etapas comerciais existentes | funil | etapa inexistente |
| vendas > 0 e cobertura < 100% | Cobertura de atribuição | ROAS por origem sem receita por origem |
| sem nada informado | frase "Sem números comerciais informados" | qualquer KPI com zero |

## Dado ausente

- `null` → **não aparece** (ou "Não informado" em nota), nunca `0`.
- `0` informado → aparece como `0`.
- Derivado sem numerador e denominador válidos → não calcula.
- "Sem venda" e "venda sem origem identificada" são estados diferentes e visíveis.

## Estados de atribuição

`attributionOf` (`lib/reports/conversionMode.ts`):

| Estado | Condição | Leitura |
|---|---|---|
| Não se aplica | vendas não informadas | sem seção |
| Sem origem | vendas > 0, nenhuma com origem | "0 de 5 com origem · 0%" + aviso |
| Parcial | algumas com origem | "3 de 5 com origem · 60%" |
| Completa | todas com origem | só a tabela por origem |

## Cor semântica

Hoje o delta usa `inverse` por métrica (`metricRefInverse`: custo, CPC, CPM → menor é
melhor). Regra-alvo:

| Natureza | Subir |
|---|---|
| volume de resultado (mensagens, cliques, vendas, receita) | bom |
| custo por resultado (CPC, custo por conversa) | ruim |
| investimento | **neutro** — sem cor (pendente no relatório 1) |

## Gráficos

**Permitidos:** número isolado com delta; funil com taxas entre etapas; tabela/matriz
para comparação entre categorias; barra horizontal para ranking.

**Evitar:** funil que atravessa as duas pipelines; trapézios que encolhem rótulos;
cartão por célula de informação; gauge decorativo; área verde grande repetindo um
número que já está no topo.

## Exemplos de feedback parcial

**Só "+12 seguidores (829 → 841)"**
> Semana de audiência — 12 seguidores novos.
> Resumo: Seguidores 841 · +12 na semana
> Não informado no feedback da semana: receita, vendas, agendamentos.

**"8 agendamentos e 5 vendas"**
> 5 vendas fechadas.
> Resumo: Vendas 5 · Agendamentos 8 — sem ticket, sem ROAS
> Funil: conversas → 8 → 5

**"5 vendas, R$ 4.100, #1 #1 #2"**
> Resumo: Receita · Vendas · Ticket · Retorno sobre o anúncio
> Cobertura de atribuição: 3 de 5 com origem · 60%
