# Pipelines de relatório — anúncios e vendas

Duas automações distintas, em cascata, com fontes, gatilhos e perguntas diferentes.
Não é uma automação só, e o relatório de vendas não é uma continuação visual do de
anúncios.

| | Automação 1 · `relatorio_trafego_semanal` | Automação 2 · `relatorio_vendas` |
|---|---|---|
| Pergunta | Como a mídia performou? | O que a mídia virou em resultado para o negócio? |
| Fonte | API de mídia (Meta / Windsor) | Comentário do Feedback da semana |
| Gatilho | `due_date` do molde recorrente = hoje (cron diário às 12:00 UTC, 9h em Brasília; moldes às segundas) | Revisão final do relatório de anúncios + comentário humano (cron **ou** hook de comentário) |
| Período | Segunda a domingo anteriores à execução (`reportPeriodFor`) | O mesmo da ocorrência |
| IA | Nenhuma | Nenhuma por padrão: parser do modelo de comentário; IA só com `COMMENT_AI_FALLBACK=1` |
| Registro | `traffic_reports` | `conversion_reports` |
| PDF | `lib/reports/adsReportPdf.tsx` | `lib/reports/salesReportPdf.tsx` |

Stack: TypeScript + `@react-pdf/renderer` dentro do Next.js (runtime `nodejs`), na Vercel.

---

## Fluxo

```
molde recorrente "Relatório de anúncios"
  │  cron → runAutomations() — dependentes rodam depois de quem dependem
  ▼
Automação 1                                                    lib/automations/run.ts
  ensureFlowOccurrence → ensureFlowStep("trafego")
  busca API → renderAdsReportPdf → storage (pasta única) → documents
  recordTrafficReport(revision N, snapshot dos posts)
     sem revisor na etapa → status = finalized   (a geração já é a versão final)
     com revisor          → status = generated   (espera a aprovação da etapa)
  ▼
[humano revisa, se houver revisor]  → aprova a etapa `trafego`
  ▼
Automação 2                                                    lib/automations/conversionFlow.ts
  gate: currentTrafficReport(etapa) é final?  senão → espera
        finaliza o registro (finalized_at = momento da APROVAÇÃO, não do cron)
  pede o feedback (uma vez) na etapa de tráfego
  lê SÓ comentários humanos posteriores à finalização
  extractMetrics → valores (null = não informado)
  conversionModeOf / attributionOf
  claimConversionReport  ← chave única; duplicata para aqui
  task_metrics (só chaves informadas) → etapa `feedback` → PDF (mídia do snapshot)
  ▼
settleTypelessFlow fecha o pai quando as duas etapas são aprovadas
```

### Por que o gate usa "sem revisor = final"

Os seis moldes em produção (15/09) não têm `reviewer_id`. Com essa regra o ritmo deles
não muda: o relatório de anúncios nasce final e o de vendas segue reagindo ao
comentário como antes. O gate só segura quem configurar revisão — que é exatamente o
caso em que rodar sobre o PDF v1 estava errado.

Consequência a conhecer: com revisor, **aprovar** a etapa de tráfego não dispara nada
na hora. O cron do dia seguinte pega, ou um comentário feito depois da aprovação
dispara imediatamente pelo hook.

---

## Dependência declarada

`automation_configs.depends_on_config_id` (migração `20260915000000`).

- O catálogo (`lib/automationCatalog.ts`) declara `relatorio_vendas.dependsOn =
  "relatorio_trafego_semanal"`.
- Ao salvar, `resolveDependsOn` (`lib/supabase.ts`) procura a automação de anúncios **no
  mesmo card** e grava o id. Sem ela, recusa com 400 e a mensagem chega à tela.
- Trocar o card de uma automação de vendas re-resolve a dependência.
- A automação de anúncios só entra em modo fluxo se alguma de vendas **declara**
  depender dela (`hasDependentConversion`). Antes era dedução por co-locação.
- Vendas sem dependência não roda: `runConversionFlow` devolve erro explícito no resumo
  do cron.
- As 6 configurações existentes foram ligadas pela própria migração.

---

## Entidades

### `traffic_reports`

| Campo | Papel |
|---|---|
| `task_id` + `revision` | único; revisão N da etapa |
| `occurrence_id` | o pai do fluxo — como a Automação 2 acha o relatório da semana |
| `snapshot` | `{ campaignPosts, prevCampaignPosts, adPosts }` exatamente como entraram no PDF |
| `status` | `generated` → `finalized`; revisões antigas viram `superseded` |
| `finalized_at` | geração (sem revisor) ou aprovação da etapa (com revisor) |
| `document_id` | o PDF |

### `conversion_reports`

| Campo | Papel |
|---|---|
| `traffic_report_id` | a revisão **final** do tráfego sobre a qual foi gerado |
| `feedback_task_id`, `source_comment_at` | a etapa e o comentário lido (`at` é o id estável do comentário) |
| `mode` | `followers_only` · `sales_summary` · `sales_segmented` · `no_data` |
| `conversion_metrics` | só as métricas informadas — chave ausente = não informado |
| `attribution` | `{ informadas, comOrigem, coberturaPct, porFonte }` |
| `parser` | `parser` · `formato não reconhecido` · `comentário ambíguo` · `llm` (só com fallback) |

Nenhuma das duas substitui `documents` (o artefato) nem `task_metrics` (a série por
card, também lida pela tela de Performance).

---

## Idempotência

| Risco | Proteção |
|---|---|
| Cron duas vezes no dia | `automation_configs.last_run_date` (Automação 1) |
| Ocorrência / etapa duplicada | ids determinísticos + tolerância a `23505` |
| Regerar o tráfego da mesma semana | revisão no nome + pasta única no storage |
| Comentário processado duas vezes | `payload.feedback_source_at` |
| Hook e cron ao mesmo tempo, retry, webhook duplicado | índice único `(feedback_task_id, traffic_report_id, source_comment_at)` — reivindicado antes de qualquer escrita |
| Falha no meio da geração | a reivindicação é desfeita no `catch`, para o retry não ficar bloqueado |
| Vendas sobre revisão obsoleta do tráfego | `currentTrafficReport` ignora `superseded`; nova revisão substitui as anteriores |
| Comentário editado | **não reprocessa** (o PATCH preserva o `at`). Registrado como pendente |

---

## Observabilidade

Uma linha JSON por geração (`lib/automations/reportLog.ts`), `event: "report_run"`:
`report_type, automation_id, client_id, task_id, period, revision, mode, parser,
llm_used, source_comment_at, status, duration_ms`. Filtrável nos logs da função na
Vercel. Custo de IA por execução ainda **não** é emitido — ver `comment-parser.md`.

---

## Estado desta rodada

**IMPLEMENTADO**
- Ausência ≠ zero em extração, `task_metrics`, comentário-resumo e PDF.
- `traffic_reports` / `conversion_reports` com revisão, snapshot e reivindicação idempotente.
- Gate da cascata na revisão final; leitura só de comentários posteriores.
- `depends_on_config_id` resolvido no servidor e mostrado na tela (Fonte / Depende de).
- Relatório de vendas modular: KPIs só do informado, funil comercial, mídia como
  contexto, cobertura de atribuição, ROAS por origem só com receita por origem.
- Log estruturado por geração.

**ALTERADO**
- A Automação 2 lê a mídia do snapshot em vez de chamar a API.
- O marcador `payload.trafego_report_at` deixou de ser escrito; o sinal é o registro.
- Nome do PDF de tráfego ganha `-rN` a partir da revisão 2.

**MANTIDO**
- Recorrência, ids determinísticos, fluxo dinâmico (`ensureFlowStep`), rotas de comentário.
- Formato de `task_metrics.metrics` (`Record<string,string>`).
- Status das etapas no quadro (a etapa de tráfego continua indo para `revisao`).

**NÃO ALTERADO**
- Relatório de anúncios (layout). Parser do comentário (continua LLM com atalho regex).

**PENDENTE** (prioridade)
- ALTA — revisão humana do tráfego virando patch estruturado `{actions:[…]}` + PDF v2.
- ALTA — relatório de anúncios: resumo executivo, matriz Tráfego × Engajamento, funil no topo.
- ALTA — aprovar a etapa de tráfego disparar a Automação 2 na hora (hoje: próximo cron).
- MÉDIA — criativos com estados calculados; investimento como variável neutra.
- MÉDIA — comentário editado reprocessar.
- MÉDIA — custo por execução no log (gatilho do parser determinístico).
- BAIXA — frase de diagnóstico determinística no relatório de anúncios.

---

## Agendamento

- Job `automations-run-daily` (pg_cron) às **12:00 UTC = 9h em Brasília**, todo dia
  (migração `20260915130000`). Continua diário: a Automação 2 precisa do tique para fechar a
  semana de quem não respondeu.
- Os moldes de relatório vencem **na segunda** (`recurrence_weekdays = [1]`). A Automação 1 só
  gera no dia em que o molde vence; o período é segunda a domingo anteriores
  (`reportPeriodFor`: termina na véspera, o dia da execução nunca entra pela metade).
- A ocorrência do fluxo usa o ciclo **seguinte** ao do molde (`ensureFlowOccurrence`). Com o
  ciclo atual, a primeira semana em modo fluxo reaproveitava a ocorrência que o modo normal
  criou na semana anterior.

## Responsável das etapas

As etapas de relatório (`trafego`, `feedback`) nascem com quem está marcado na frente
`gestor_trafego` em Configurações › Equipe & papéis — hoje Allan e Luiza —, e não com o
autor de automação "North ai" (`lib/automations/responsibleOwners.ts`). É o que coloca o
card na Home, na coluna e no atraso de quem executa. Sem ninguém marcado, fica o autor de
automação.

Rotina da Luiza na segunda: a etapa "Relatório de anúncios" chega em Revisão com o PDF e o
pedido de feedback → ela confere e aprova → pede os números ao cliente e comenta no modelo
→ a etapa "Feedback da semana" nasce com o relatório de resultados, prazo quarta → ela
revisa, envia e aprova. As duas aprovadas fecham a ocorrência.

## Fluxo de exemplo

Molde com `payload.report_example = true` roda o fluxo completo, mas **não grava
`task_metrics`**: os números do feedback são ilustrativos e apareceriam como resultado real na
tela de Performance e no comparativo da semana seguinte.

## Custo por geração

Medido em 15/09 com a CRIS CAR CARE (semana 07–13/09, 258 linhas de campanha, 422 de anúncio,
7 criativos), sem IA:

| Etapa | Tempo | CPU | Chamadas externas |
|---|---|---|---|
| Automação 1 · busca no Meta (6 semanas + criativos) | 13,4 s | 0,70 s | 12 |
| Automação 1 · miniaturas (311 KB) | 1,1 s | 0,13 s | 14 |
| Automação 1 · PDF de anúncios (370 KB) | 0,9 s | 1,39 s | — |
| Automação 2 · leitura do comentário (parser) | 0,01 s | 0,02 s | 0 |
| Automação 2 · PDF de resultados (137 KB) | 0,3 s | 0,33 s | — |

Em preço de lista da Vercel (Fluid compute: CPU ativa US$ 0,128/h, memória provisionada
US$ 0,0106/GB-h com 2 GB, invocação US$ 0,60/milhão):

| | Por geração |
|---|---|
| Relatório de anúncios (~15 s de parede, ~2,2 s de CPU) | ≈ US$ 0,00017 |
| Relatório de resultados (~2 s de parede, ~0,5 s de CPU) | ≈ US$ 0,00003 |
| Par da semana | **≈ US$ 0,0002 ≈ R$ 0,001** |
| Storage (~0,8 MB por semana por cliente, US$ 0,021/GB-mês) | desprezível |
| API do Meta | sem custo |
| IA, só com `COMMENT_AI_FALLBACK=1` (gpt-5-mini: ~800 tokens de entrada, até 1.500 de saída) | até US$ 0,0032 ≈ R$ 0,017 por comentário |

Contra o orçamento de R$ 10 para mais de 60 relatórios: sem IA, R$ 10 cobrem ~9.000 pares;
com a IA lendo todo comentário, ~550. No plano Hobby, a franquia mensal da Vercel cobre o
volume atual e o custo efetivo é zero. O tempo é dominado pela latência da API do Meta, não
pela renderização.
