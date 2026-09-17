# Pipeline de relatórios: anúncios e conversão

São duas configurações e dois produtos diferentes.

| Configuração | Alvo | Pode existir sozinha | Resultado |
|---|---|---:|---|
| `relatorio_trafego_semanal` | Tarefa recorrente comum | sim | PDF de anúncios em uma Tarefa |
| `relatorio_vendas` | Entrega recorrente `Automação` | não | PDF de conversão após Feedback |

`relatorio_vendas.depends_on_config_id` aponta para a configuração de anúncios
do mesmo cliente. Ao cadastrar conversão sem anúncios, o backend cria a
configuração dependida na mesma transação.

## Ciclo composto

```text
08:00 BRT
  Relatório de anúncios: Entrada → Em produção → Revisão
                                      │ PDF + traffic_reports revision
                                      ▼ aprovação manual
  Feedback: Entrada, prazo +2 dias corridos
                                      ▼ aprovação manual
  Relatório de conversão: Em produção → Revisão
                                      ▼ aprovação manual
  Entrega Automação: concluída
                                      ▼
  próxima Entrega + primeiro Relatório de anúncios em Entrada
```

1. A ocorrência da Entrega e o primeiro relatório nascem juntos em `Entrada`.
2. O cron `0 11 * * *` (08:00 America/Sao_Paulo) move o relatório para
   `Em produção` antes de consultar mídia.
3. O PDF pronto leva o card para `Revisão`; gestores de tráfego recebem o
   encaminhamento e as notificações.
4. Aprovar o relatório cria ou reutiliza o passo `Feedback`, com prazo de dois
   dias corridos. Um card externo já ligado é preservado.
5. Comentário no Feedback nunca muda seu status. Vencimento gera atraso, não
   aprovação. Checkbox/arrasto/aprovação manual conclui o Feedback.
6. Aprovar Feedback materializa uma única Tarefa `Relatório de conversão`,
   gera o PDF e a deixa em `Revisão`.
7. Aprovar a Conversão conclui a Entrega e materializa a ocorrência seguinte
   com seu primeiro relatório em `Entrada`.

Se um Feedback previamente ligado já estiver aprovado quando o relatório de
anúncios for aprovado, o motor percorre imediatamente esse passo concluído,
materializa a Conversão e inicia seu processamento.

## Fonte de dados e revisão

- `traffic_reports` guarda revisão, snapshot exato da mídia, documento e
  `finalized_at`. A Conversão usa esse snapshot; não consulta a API novamente.
- `conversion_reports` reivindica de forma única a combinação entre relatório
  de anúncios final e Feedback.
- `task_metrics` recebe somente campos realmente informados. Ausência não vira
  zero.
- O comentário humano mais recente no Feedback pode fornecer as métricas, mas
  a aprovação manual é o único gate de execução nesta versão.

## Idempotência e retry

`automation_runs` substitui `last_run_date` como ledger de execução. A chave é
`(config_id, occurrence_key, action)` e os estados são `pending`, `running`,
`succeeded` e `failed`, com tentativas, horários e último erro.

- IDs determinísticos impedem duplicação de ocorrência e passo.
- `(parent_id, workflow_step_id)` impede dois cards no mesmo passo.
- `claim_automation_run` permite retry de `failed` e não reivindica
  `succeeded`.
- O PDF de conversão só é anexado depois da reivindicação durável.
- Falha parcial registra `failed`; o retry continua do ponto seguro.

## Operação em produção

Produção é o único ambiente integrado. O corte usa os preflights em
`supabase/preflight`, as migrations `20260917120000` e `20260917121000`, o
cleanup allowlisted de Storage e o postflight em `supabase/postflight`.

Se a publicação terminar depois de 18/09/2026 08:00 BRT, um administrador deve
executar uma única chamada idempotente à rota de automações com `today =
"2026-09-18"` e somente os cinco IDs de configuração de anúncios auditados. O
ledger registra `scheduled_for = 2026-09-18T11:00:00Z` e impede repetição.

## Roadmap

Aprovação determinística do Feedback por comentário do revisor permanece
futura. Até essa regra ter identidade de revisor, comando explícito e testes de
idempotência, comentários são apenas conteúdo.
