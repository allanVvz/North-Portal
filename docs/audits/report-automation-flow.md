# Auditoria — fluxo de geração de relatórios (Automação 1 e 2)

Data: 2026-09-15. Feita contra o código em `main` (commit `78f1359`) e contra os dados de
produção (projeto `rqwycltgnnvaunvmyxea`).

Escopo: as duas automações que formam a cascata semanal de relatórios. **Não** é o
sistema de tarefas em geral — o que está aqui é só o caminho que leva de uma tarefa
recorrente até dois PDFs.

> **Correção de premissa.** O briefing que originou esta auditoria assume Python. Não é:
> os dois PDFs são TypeScript/React via `@react-pdf/renderer`, renderizados dentro do
> Next.js (runtime `nodejs`) e publicados na Vercel. A arquitetura proposta continua
> válida; a linguagem, não.

> **Skills de UX pedidas no briefing.** `dashboard-designer`, `data-visualization`,
> `dataviz` e `ui-design-pro` **não existem** — nem instaladas no ambiente nem no catálogo
> de plugins oficial (verificado em `~/.claude/plugins/plugin-catalog-cache.json`). O que
> existe instalado no repo é `.claude/skills/ui-ux-pro-max-skill` (banner-design, brand,
> design, design-system, slides, ui-styling, ui-ux-pro-max). Nenhuma substituição
> silenciosa foi feita: o baseline de UI (`report-ui-baseline.md`) foi produzido sem elas
> e está marcado como tal.

---

## 1. O fluxo real, como está no código

```
tarefa recorrente M1 ("Relatório de anúncios", recurrence_cadence=semanal)
  │
  │  cron diário → POST /api/admin/automations/run (x-cron-secret)
  │  runAutomations() lê automation_configs ativas
  │  ordena relatorio_trafego_semanal ANTES de relatorio_vendas
  ▼
Automação 1 · relatorio_trafego_semanal   (run.ts:140 runOneReportAutomation)
  │  gate: target.due_date === hoje  E  last_run_date !== hoje
  │  flowMode = aiReady && recorrente && hasConversionFlow(target)
  │
  ├─ flowMode = false → preenche o próprio card / a ocorrência do ciclo
  │
  └─ flowMode = true
       ensureFlowOccurrence()  → ocorrência do ciclo vira flow_parent (2 etapas)
       ensureFlowStep(occ, "trafego")
       fillReportCard()        → Windsor/Meta → renderAdsReportPdf → storage → documents
       etapa trafego: status=revisao, payload.trafego_report_at=now
       advanceFlowMold()       → molde anda pro próximo ciclo
  ▼
[humano comenta os números — no card de tráfego ou no pai]
  │  POST /api/admin/tasks/[id]/comments
  │  flowCommentTargetId() decide em QUAL card o comentário é gravado
  │  handleConversionComment() dispara na hora (não espera o cron)
  ▼
Automação 2 · relatorio_vendas   (conversionFlow.ts:192 processOccurrence)
  │  gate: existe etapa `trafego` COM payload.trafego_report_at
  │  extractMetrics(comentário) → IA
  │  task_metrics.upsert (métricas + period_from/period_to)
  │  ensureFlowStep(occ, "feedback") → etapa 2
  │  generateSalesReport() → busca Windsor/Meta DE NOVO → renderSalesReportPdf
  │  etapa feedback + pai → revisao
  ▼
settleTypelessFlow() fecha o pai quando as duas etapas são aprovadas
```

### Entidades

| Coisa | Onde mora |
|---|---|
| Configuração da automação | `automation_configs` (`automation_key`, `target_task_id`, `performance_template_id`, `collect_metric_keys`, `active`, `last_run_date`) |
| Ocorrência do ciclo | `tasks`, id determinístico `recurringExecutionId(moldId, cycle)` |
| Etapas do fluxo | `tasks`, id determinístico `flowStepTaskId(occId, slot)`; elo em `task_links` |
| Comentários | `tasks.payload.comments[]` (jsonb) |
| Métricas comerciais | `task_metrics` (`metrics` jsonb, `source`, `period_from`, `period_to`) |
| PDFs | Supabase Storage + linha em `documents` |
| Métricas de mídia | **em lugar nenhum** — buscadas da API a cada render |

---

## 2. As 10 perguntas do briefing

**1. Como uma tarefa recorrente gera a próxima execução?**
`materializeOccurrenceForReport` / `ensureFlowOccurrence` (`lib/automations/execute.ts`).
O id é determinístico por `(molde, ciclo)` — `recurringExecutionId`. O molde é avançado
por `advanceFlowMold`, chamado **só depois** do preenchimento dar certo, para uma falha
não pular um ciclo. A matemática da data é `nextRecurringDueDate` (`lib/recurrence.ts`),
a mesma do caminho humano — não há reimplementação.

**2. Quais atributos são copiados para a nova tarefa?**
`recurringExecutionFields(parent, id, dueDate, cycle)`. No caminho de fluxo, `payload`
ainda recebe `flow_parent: true`, `flow_total_weight: 2`, `flow_step_count: 2` e perde o
`DEFERRED_TASK_FLAG`.

**3. Como pai/filho é armazenado?**
`task_links (parent_id, child_id, slot, position)`. O elo legado `plan_id` foi migrado
para lá (ver `higiene-modelo-tarefas`). O pai carrega os marcadores de fluxo no payload.

**4. Como a etapa seguinte da cascata é criada?**
`ensureFlowStep(admin, parent, slot, fields, today)` (`lib/flows/advance.ts`) — fluxo
**dinâmico**, sem `task_type`. É deliberado: existiu uma versão com tipo de entrega real
(`relatorio_conversao`, migração 20260901) e foi desativada um dia depois
(20260902000000), porque (a) qualquer card recorrente existente vira o fluxo sem
reclassificar `kind`, e (b) a etapa de tráfego fica em revisão **antes** da etapa de
feedback nascer, e o motor padrão de cascata só avança quando uma etapa é *concluída*.

**5. Como comentários são persistidos e o que disparam?**
`appendTaskComment` grava em `payload.comments[]`. O POST dispara, em sequência e
**síncronos na request**: `notifyTaskParticipants` e `handleConversionComment` — este
último pode renderizar o PDF de vendas inteiro dentro do request (por isso
`runtime = "nodejs"` na rota). PATCH/DELETE de comentário **não** disparam nada.

**6. Como automações são associadas a um cliente?**
Não são, diretamente. A v2 removeu `client_id` (migração `20260821025700`): a automação
aponta para um **card** (`target_task_id`), e o cliente é o do card. Uma automação por
`(card, automation_key)` — índice único de `20260901000200`.

**7. Como a configuração da UI é persistida?**
`AutomationSettings.tsx` → `/api/admin/automations` → `automation_configs`. Toggle =
`active`; tipo = `automation_key`; funil/template = `performance_template_id`; métricas
lidas do comentário = `collect_metric_keys` (chips, `TagChipsInput`). Rótulo, descrição e
regra de elegibilidade **não** estão no banco — vivem em `lib/automationCatalog.ts`.

**8. O sistema diferencia semanticamente os dois relatórios?**
Parcialmente. Existem duas `automation_key` distintas e dois renderizadores distintos.
Mas **a dependência entre eles não é declarada** — ver A6.

**9. Onde está a fonte de verdade do relatório?**
Para o relatório de **vendas**: `task_metrics` (e `payload.metricas` / `payload.linhas` na
etapa de feedback). Para o de **tráfego**: não existe — ver A2.

**10. O PDF é usado como fonte de dados?**
Não. É só output. (O que é bom — mas como não há snapshot, a informação que gerou o PDF
se perde.)

---

## 3. Achados

| # | Severidade | Achado |
|---|---|---|
| A1 | **CRÍTICA** | **A cascata não espera revisão.** `processOccurrence` (`conversionFlow.ts:205`) só exige que a etapa de tráfego tenha `payload.trafego_report_at`. A etapa fica em `revisao`, mas nada espera o humano terminar: basta alguém comentar os números para a Automação 2 rodar sobre um relatório ainda em revisão. |
| A2 | **CRÍTICA** | **O relatório de tráfego não deixa fonte de verdade nem revisão.** `fillReportCard` (`run.ts:72`) busca da API, renderiza e sobe com nome fixo `relatorio-trafego-<period.to>.pdf` e `upsert: false` — **regerar a mesma semana falha** no upload e marca o card `parada`. Não existe `revision` nem caminho de "revisar e regerar". |
| A3 | **ALTA** | **Os dois relatórios buscam a API separadamente** para a mesma semana (`run.ts:94` e `generateSalesReport`). Os números do mesmo período podem divergir entre os dois PDFs, e a Automação 2 paga uma segunda janela de chamadas. |
| A4 | **CRÍTICA** | **Ausência vira zero.** `extractMetrics` preenche *toda* tag pedida com `0` (`extractMetrics.ts:77,89`), e `processOccurrence` grava isso em `task_metrics` (`:287`). Com o comparativo semana a semana ligado em 14/09, um cliente que só diga "+12 seguidores" grava `vendas=0, receita=0` — e a semana seguinte lê "receita caiu 100%". |
| A5 | **ALTA** | **O relatório 2 repete o 1.** Os dois renderizam o mesmo `CampaignBlocksSection`, e o funil do relatório de vendas refazia Alcance→Cliques→Conversas antes das etapas comerciais. |
| A6 | **ALTA** | **A dependência é convenção, não atributo.** `hasConversionFlow()` (`run.ts:51`) deduz a cascata de "existe outra config com o mesmo `target_task_id`". Nada no schema diz que a Automação 2 depende da 1; a ordem correta de execução é garantida por um `sort()` em memória (`run.ts:252`). |
| A7 | **MÉDIA** | **LLM no caminho crítico toda semana.** O atalho determinístico (`NUM_ONLY`, `extractMetrics.ts:53`) só resolve comentário de **uma** métrica isolada. "Vendas: 5, Agendamentos: 8" já chama o modelo. |
| A8 | **MÉDIA** | **Geração pesada dentro do request HTTP.** `handleConversionComment` renderiza o PDF dentro do POST de comentário. Um erro de IA ou de storage aparece como lentidão ao comentar. |
| A9 | **BAIXA** | **Comentário editado não reprocessa.** A idempotência usa `feedback_source_at` = carimbo `at` do comentário, que o PATCH preserva. Corrigir um número no comentário não regera o relatório — hoje isso é silencioso. |

### Compatibilidade a preservar

`task_metrics.metrics` é lido também por `listPublishedTasks` (`lib/supabase.ts:2320`),
que o tipa como `Record<string, string>` para cards `criativo/publicacao` — população
diferente da do fluxo de conversão. **A forma do jsonb não pode mudar.** A correção de A4
é *omitir a chave ausente*, não trocar o tipo do valor.

---

## 4. Idempotência hoje

| Risco | Proteção atual | Suficiente? |
|---|---|---|
| Cron duas vezes no dia | `automation_configs.last_run_date` (só Automação 1) | Sim |
| Ocorrência duplicada | id determinístico `(molde, ciclo)` + tolerância a `23505` | Sim |
| Etapa duplicada | id determinístico `(occ, slot)` | Sim |
| Comentário processado 2× | `payload.feedback_source_at` (carimbo do comentário) | Sim |
| Relatório de vendas 2× | `payload.sales_report_generated_at` | Sim |
| Relatório de tráfego 2× | **nenhuma** — o upload com nome fixo falha | **Não** (A2) |
| Comentário editado | nenhuma (por desenho) | Ver A9 |

---

## 5. Custo de IA por execução

Uma execução da Automação 2 faz **uma** chamada: `extractMetrics`, ~600 tokens de entrada
(prompt de sistema + comentário) e ~200 de saída, em modelo pequeno (`gpt-5-mini` por
padrão; `AI_MODEL` sobrescreve). Ordem de grandeza: frações de centavo por relatório.

Orçamento definido pelo usuário: **R$ 10 devem gerar mais de 60 relatórios** → teto de
**R$ 0,167 por relatório**. Pela estimativa acima o teto já é respeitado com folga, então
o parser determinístico **não** é justificado por custo hoje. Ver
`docs/reporting/comment-parser.md` para o gatilho medido e para os dois motivos que
podem antecipá-lo (modelo indisponível; API fora do ar zerando a semana).
