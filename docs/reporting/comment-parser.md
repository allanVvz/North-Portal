# Leitura do comentário de feedback

`lib/ai/commentParser.ts` (parser determinístico) e `lib/ai/extractMetrics.ts` (entrada
única). Transforma o comentário do Feedback da semana em valores estruturados para o
relatório de resultados. **Sem IA por padrão.**

## Contrato

```ts
type MetricExtract = {
  valores: Record<string, number | null>; // null = não informado · 0 = informado como zero
  linhas: ConversionRow[];                // venda a venda: serviço, valor, fonte #1/#2/#3, status
  note: string;                           // "parser" | "formato não reconhecido" | "comentário ambíguo" | "llm" | …
  problemas?: string[];                   // o que ficou de fora, em frase para o gestor corrigir
};
```

A regra que nenhum caminho quebra: **ausência não é zero**.

| Situação | Resultado |
|---|---|
| "5 vendas" (sem falar de receita) | `vendas: 5, receita: null` |
| "nenhuma venda essa semana" | `vendas: 0` |
| comentário vazio | tudo `null` |
| vendas sem agendamentos | `agendamentos: null` (nunca inferido de vendas) |
| linhas com valor, sem total de receita | `receita` = soma das linhas fechadas |
| total de receita declarado | vence a soma das linhas |

Seguidores é **total do perfil** ao fim do período, nunca o ganho ("de 829 pra 841" → 841).
O ganho é derivado da série. "Ganhamos 17 seguidores" não vira total: fica de fora com aviso.

## O comentário correto

O pedido de feedback (`conversionFlow.ts → pedidoDe`) mostra este modelo, gerado por
`feedbackTemplate(tags)`:

```
Vendas: 5
Agendamentos: 8
Receita: R$ 4.100
Seguidores: 841
#1 PPF frontal R$ 1.200
#2 Higienização interna R$ 900
```

- Uma informação por linha. Linha ausente = não informado; 0 só quando foi zero.
- Linhas `#1`/`#2`/`#3` são opcionais: uma por venda, com a origem do anúncio, o serviço e o
  valor. "agendado" na linha marca venda ainda não fechada (fora da soma da receita).

## Pipeline

```
comentário
  ├─ vazio → nulos
  └─ parseFeedbackComment
        PARSED_OK / PARTIAL  → usa (note "parser")
        AMBIGUOUS / INVALID  → sem fallback: nulos + note → o fluxo responde no card
                               com o modelo e segue esperando
                             → com fallback: LLM (aiComplete)
```

A IA só entra com `COMMENT_AI_FALLBACK=1` (ou `AI_CLI=1` em dev). Com o fallback ligado, ela
também é usada quando o parser leu, mas marcou `precisaIa` (origem no meio da frase, ganho de
seguidores sem total).

Variações que o parser aceita:

| Métrica | Formas |
|---|---|
| vendas | `Vendas: 5` · `Vendas 5` · `5 vendas` · `nenhuma venda` |
| agendamentos | `Agendamentos: 8` · `8 agendamentos` · orçamento/proposta/cotação contam |
| receita | `Receita: R$ 4.100` · `faturamento 4.100,50` · `R$ 4.100 de receita` |
| seguidores | `Seguidores: 841` · `seguidores de 829 pra 841` → 841 |
| origem | `#1 PPF R$ 1.200` · `#2 Polimento 900` (uma venda por linha) |

Estados:

- **PARSED_OK** — toda métrica configurada encontrada.
- **PARTIAL** — algumas encontradas, outras não mencionadas (é o caso normal; não é erro).
- **AMBIGUOUS** — a mesma métrica com dois valores diferentes.
- **INVALID** — nada reconhecível.

Número sem rótulo não vira métrica: vai para `problemas`, e o resumo que a automação comenta
no card diz "Deixei de fora: …".

## Comentário fora do modelo

`processOccurrence` responde no mesmo card com o modelo (uma vez por comentário, marcador
`feedback_format_warned_for` na ocorrência) e continua esperando o próximo comentário. Passado
o prazo do feedback + tolerância, a semana fecha como "não informado", como antes.

## Custo

Orçamento: **R$ 10 devem gerar mais de 60 relatórios** (teto de R$ 0,167 por relatório). Com
o parser, a leitura do comentário custa zero. Medição por geração em
`docs/reporting/report-pipeline.md` → Custo.

## Testes

`lib/ai/commentParser.test.ts` (modelo, texto natural, zero dito, seguidores de X pra Y, ganho,
ambíguo, número sem rótulo, origem no meio da frase), `lib/ai/extractMetrics.test.ts` (parser
sem IA, fora do modelo sem fallback, parse do JSON da IA) e
`lib/reports/conversionMode.test.ts` (modos e atribuição).
