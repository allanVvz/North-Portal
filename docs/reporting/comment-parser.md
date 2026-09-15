# Leitura do comentário de feedback

`lib/ai/extractMetrics.ts`. Transforma o comentário livre do Feedback da semana em
valores estruturados para o relatório de vendas.

## Contrato

```ts
type MetricExtract = {
  valores: Record<string, number | null>; // null = não informado · 0 = informado como zero
  linhas: ConversionRow[];                // venda a venda: serviço, valor, fonte #1/#2/#3, status
  note: string;                           // "regex" | "llm" | "nada identificado" | "IA indisponível: …"
};
```

A regra que nenhum caminho quebra: **ausência não é zero**.

| Situação | Resultado |
|---|---|
| "5 vendas" (sem falar de receita) | `vendas: 5, receita: null` |
| "não vendemos nada essa semana" | `vendas: 0` |
| comentário vazio | tudo `null` |
| IA fora do ar / resposta ilegível | tudo `null` + `note` |
| vendas sem agendamentos | `agendamentos: null` (nunca inferido de vendas) |
| linhas com valor, sem total de receita | `receita` = soma das linhas |
| total de receita declarado | vence a soma das linhas |

Por que importa: `task_metrics` é série temporal. Um zero gravado por ausência vira
"receita caiu 100%" no comparativo da semana seguinte.

Seguidores é **total do perfil** ao fim do período, nunca o ganho ("foi de 829 pra 841" →
841). O ganho é derivado da série.

## Pipeline atual

```
comentário
  ├─ vazio → nulos
  ├─ regex NUM_ONLY ("12 agendamentos", uma métrica só) → sem IA
  └─ LLM (aiComplete: Anthropic ou OpenAI, conforme o provedor configurado)
        prompt: omitir chave não mencionada; 0 só quando dito
        → parseMetricJson (tolerante: corta o JSON do meio do texto)
```

Atribuição por origem é agregada **fora** do LLM, em código
(`lib/reports/conversionMode.ts → attributionOf`):

- conta como venda atribuída a linha com fonte e status diferente de "agendado";
- com `vendas = 5` e linhas `#1, #1, #2` → 3 atribuídas, 2 sem origem, cobertura 60% —
  nunca 5 atribuídas;
- receita por origem só existe quando alguma venda daquela origem trouxe valor;
  receita total nunca é distribuída entre fontes.

## Custo e o gatilho do parser determinístico

Orçamento definido: **R$ 10 devem gerar mais de 60 relatórios** → teto de
**R$ 0,167 por relatório** (~US$ 0,03).

Uma extração é uma chamada de ~600 tokens de entrada e ~200 de saída em modelo pequeno —
ordem de grandeza de frações de centavo. O teto provavelmente já é respeitado com
folga, então o parser determinístico **não foi implementado nesta rodada**.

Quando ele entra:

1. **Por custo, medido:** quando a média de 4 semanas de custo por relatório passar de
   R$ 0,167. Pré-requisito: emitir tokens/custo no log `report_run` (pendente — hoje o
   log só diz `parser` e `llm_used`).
2. **Antes disso, por robustez**, se um destes pesar:
   - modelo default indisponível (em 14/09 o `gpt-5-mini` devolvia 404 até a organização
     OpenAI ser verificada) — a semana inteira vira "não informado";
   - latência: a extração roda dentro do POST de comentário.

## Desenho do parser determinístico (quando entrar)

Parser primeiro, LLM só como fallback:

```
comentário → parser → validação → PARSED_OK | PARTIAL | AMBIGUOUS | INVALID
                                     │          │          │
                                   usa      usa + LLM   LLM
                                            só no resto
```

Variações que o parser deve aceitar sem LLM:

| Métrica | Formas |
|---|---|
| vendas | `vendas: 5` · `Vendas 5` · `5 vendas` |
| agendamentos | `agendamentos: 8` · `8 agendamentos` · orçamento/proposta/cotação contam |
| receita | `receita: 4100` · `Receita R$ 4.100` · `faturamento 4.100,50` · `4100.50` |
| seguidores | `seguidores: 841` · `seguidores 829 para 841` → 841 |
| origem | `#1 1200` · `#2 900` (uma venda por linha) |

Estados:

- **PARSED_OK** — toda métrica configurada encontrada sem conflito.
- **PARTIAL** — algumas encontradas, outras não mencionadas (é o caso normal; não é erro).
- **AMBIGUOUS** — a mesma métrica com dois valores, ou número sem rótulo.
- **INVALID** — nada reconhecível.

Casos de teste a cobrir ao implementar: só seguidores; seguidores + vendas; vendas +
agendamentos + receita; fora de ordem; vírgula e ponto decimais; `#1/#2/#3`; tags
repetidas; soma das tags diferente do total; zero vendas; zero receita; ambíguo; fallback.

## Testes hoje

`lib/ai/extractMetrics.test.ts` (nulos vs zeros, soma de linhas, agendamento não
inferido, IA indisponível) e `lib/reports/conversionMode.test.ts` (modos e atribuição).
