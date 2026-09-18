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

O estado da Entrega é sempre a projeção da etapa aberta: antes do cron, ambos
estão em `Entrada`; durante a execução do relatório, ambos estão em `Em
produção`; em revisão, ambos mostram `Revisão`. Nenhuma tela usa um estado
gravado manualmente no parent.

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

## Roteamento de comentários e escrita atômica

A Entrega é o contêiner visual; as tarefas filhas (etapas) são a fonte de
verdade das etapas e dos comentários. A leitura junta a família
(`mergeFamilyComments`); a **escrita** vai sempre para uma etapa, nunca para o
pai por a interface aberta ser a Entrega, e nunca replicada em pai e filho.

### Regra de destino (`lib/flows/commentTarget.ts`)

1. `stage_task_id` no corpo do POST é a etapa que a tela mostrava como corrente.
   Precisa ser uma etapa (`workflow_step`) **desta** Entrega; senão
   `409 COMMENT_STAGE_INVALID`. O id da própria Entrega não vale. Se essa etapa
   já foi concluída e a Entrega avançou (tela desatualizada), o comentário vai
   para a etapa aberta **agora**: o banco garante uma única etapa aberta por
   Entrega, em ordem (trigger `workflow_link_is_strictly_sequential`). A linha de
   cada etapa (`StepRow`) comenta pelo id dela e grava nela mesma, concluída ou não.
2. Card que não é Entrega: o próprio card.
3. Chamada antiga, sem `stage_task_id`: só há fallback se a etapa atual for
   inequívoca — nenhuma etapa ainda (a própria Entrega), tudo concluído (a
   última) ou **exatamente uma** aberta. Com várias abertas, o papel de quem
   comentou desambigua se apontar exatamente uma (revisor de etapa em `revisao`,
   depois responsável em `task_assignees`).
4. Ainda ambíguo: `409 COMMENT_STAGE_AMBIGUOUS` com `candidates` (ids). Nada é
   gravado.

O destino é escolhido pelo **id** da etapa, nunca pelo nome textual dela.

**Uso normal:** a pessoa só escreve no modal da Entrega e conclui as etapas por ele
(o check da linha da etapa). O campo de comentário mostra em qual etapa o texto vai
cair (`Comentar em "Feedback"…`). Ao concluir uma etapa, a próxima nasce sozinha e
volta na resposta (`flow_next_task`); o comentário seguinte já vai para ela.

### Idempotência do comentário humano

`comment_id` (gerado pela interface, estável enquanto a mensagem está pendente —
`app/admin/commentIds.ts`) chega em `append_task_comment_idempotent`. Reenviar o
mesmo id devolve `inserted = false`: a rota responde 200 sem notificar, sem
@menção e sem disparar os gatilhos abaixo de novo.

Depois de gravar, a rota **responde na hora** e dispara, depois da resposta
(`after`), `handleTrafficRevisionComment` (etapa de tráfego) e
`recordFeedbackMetricComment` (etapa de Feedback). Regerar o PDF leva dezenas de
segundos; esperar por ele fazia o comentário sumir da tela e a pessoa escrever de
novo. A nova versão chega como um comentário da automação. Falha em qualquer um
dos dois não se perde: a etapa é parada com um aviso (`markTaskParada`).

- Comentário no tráfego pede uma nova revisão do PDF **enquanto a etapa não está
  concluída**. Depois de concluída ele é só conversa: não regenera.
- Nada interpreta "aprovado". Concluir uma etapa é sempre uma ação explícita
  (status). `feedbackMetricApprovalProblem` só confere se o último comentário do
  Feedback contém uma métrica que o parser lê — é uma guarda da conclusão do
  Feedback, não uma leitura de frase.

### Escrita da automação (`lib/automations/taskWrites.ts`)

A automação nunca mais lê o `payload`, gera o relatório (segundos) e o regrava
inteiro — isso apagava o comentário humano feito no intervalo.

- `updateTaskPayload` chama `automation_task_payload_update`: **um** UPDATE sob
  lock da linha que mescla só as chaves de `patch`, remove só as de `remove` e
  acrescenta no máximo um comentário ao thread que está no banco *agora*.
  `comments` nunca entra por `patch`/`remove`. Cada ação usa um id determinístico
  (`ads-report:<card>:<revisão>`, `feedback-prompt:<card>`,
  `conversion-summary:<card>:<claim>` …), então re-execução não repete o
  comentário.
- `transitionTaskStatus` é compare-and-set (`from` / `unless` / `open` no próprio
  UPDATE). Uma execução atrasada devolve `null` em vez de rebaixar a etapa — o
  trigger `tasks_sync_completed_at` limpa `completed_at` ao sair de `aprovado`,
  então um UPDATE incondicional reabriria uma etapa concluída por uma pessoa.

**O status de Entrega, molde recorrente e Plano de Ação nunca é escrito pela
automação.** Ele é a projeção do primeiro passo aberto e o banco recusa a escrita
direta (trigger `tasks_reject_manual_rollup_status`, `23514`). A Entrega vai a
Revisão porque a etapa de conversão foi a Revisão. `markTaskParada` em um card-pai
registra o erro como comentário, sem tentar mudar o status.

Onde cada guarda vale: o início do relatório de anúncios só move de
`backlog`/`parada`/`em_producao` (retry depois de um crash) e nunca de
`revisao`/`aprovacao`/`aprovado`; o fim só move de `em_producao` para `revisao`;
`markTaskParada` nunca para uma etapa `aprovado`; a regeneração de tráfego, a
conversão e o reset de etapas seguintes só tocam etapas ainda abertas.

### Avanço das etapas (`lib/flows/advance.ts`)

Etapas nascem sob demanda quando a anterior é concluída: id determinístico
`flowStepTaskId(entrega, etapa)`, `unique (parent_id, workflow_step_id)` e
`23505` tolerado — concluir duas vezes, ou dois processos ao mesmo tempo, deixa
uma tarefa só. `advanceFlow` relê a etapa concluída no banco e só avança se ela
continua concluída (um retry antigo não avança uma etapa reaberta). A Entrega
recorrente avança o molde uma vez por conclusão: se o molde já está no ciclo da
ocorrência concluída, não avança de novo, e `advanceFlowMold` é compare-and-set
no vencimento.

### Ordem de aplicação

A migration `20260918150000_atomic_task_comments.sql` é aditiva e precisa estar
aplicada **antes** do deploy do código. `supabase/postflight/20260918_atomic_task_comments_smoke.sql`
a confere dentro de uma transação com `rollback`. Se o código subir primeiro, só
o campo de comentário humano cai para a RPC antiga (sem idempotência); as
escritas das automações exigem a migration.

## Operação em produção

Produção é o único ambiente integrado. O corte usa os preflights em
`supabase/preflight`, as migrations `20260917120000`, `20260917121000` e
`20260918004358`, o cleanup allowlisted de Storage e o postflight em
`supabase/postflight`. A última migration projeta o estado do parent a partir
da etapa aberta e mantém a cascata serial; ela não cria relatório de conversão.

Se a publicação terminar depois de 18/09/2026 08:00 BRT, um administrador deve
executar uma única chamada idempotente à rota de automações com `today =
"2026-09-18"` e somente os cinco IDs de configuração de anúncios auditados. O
ledger registra `scheduled_for = 2026-09-18T11:00:00Z` e impede repetição.

## Roadmap

Aprovação determinística do Feedback por comentário do revisor permanece
futura. Até essa regra ter identidade de revisor, comando explícito e testes de
idempotência, comentários são apenas conteúdo.

No harness de IA, permanece futuro: **OpenRouter como gateway multi-provider**:
substituir chamadas diretas por API compatível, usar uma credencial OpenRouter,
definir modelo principal e fallback por política, registrar provider/model
efetivamente usados e preservar a idempotência das automações. Não faz parte da
operação atual, que usa somente OpenAI quando o fallback de IA for habilitado.
