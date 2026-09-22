# Ocorrência por período — remover a dependência da Entrega anterior

Desenho decidido em 21/09/2026, depois do incidente em que quatro clientes ficaram
sem o relatório da semana. **Implementado em 22/09/2026** — ver o estado abaixo.

## O problema: a dependência não está escrita em lugar nenhum

Ninguém codificou "espere a aprovação da Entrega anterior". A dependência emerge da
**chave de identidade da ocorrência**:

```
occId = recurringExecutionId(molde, ciclo)   →   derivedTaskId(molde, "cycle:N")
```

`lib/recurrence.ts:101`. A ocorrência é identificada por um **contador**, e esse
contador só avança quando o fluxo inteiro termina (`lib/flows/advance.ts:344`, no
laço `for (const deliveryId of finished)`). Enquanto ninguém aprova,
`ensureFlowOccurrence` devolve **a mesma** ocorrência aberta, cuja etapa não pode
ser reiniciada — o compare-and-set recusa `revisao`, e recusa **certo**: regerar
destruiria um relatório sob revisão humana.

Agravante: os dois moldes avançam em lugares diferentes. O de **anúncios** avança
na hora do PDF (`run.ts:295`); o da **Entrega**, na conclusão (`advance.ts:344`).
Dois contadores, dois gatilhos, nada garantindo que andem juntos — foi assim que a
CRIS CAR CARE chegou a anúncios ciclo 4 com Entrega ciclo 0, e só destravou com
cirurgia manual no banco.

## A forma correta: identidade pelo período

O relatório **é** "a semana de 14–20/09". Chave absoluta e idempotente. Um contador
é estado relativo que alguém precisa avançar: quem esquece trava tudo, e dois
avançadores discordam.

```
occId = derivedTaskId(molde, "2026-09-21")
```

**Já existe neste código.** `recurringExecutionId` aceita `number | string` e usa a
string verbatim; `lib/supabase.ts:1826` já passa uma data
(`explicitDateExecutionFields`). Não é um modelo novo — é estender ao fluxo de
relatórios um formato de id que o repositório já usa.

Consequências diretas:

- **A dependência desaparece por construção.** 28/09 é outra chave que 21/09. Não
  há contador para avançar, logo não há o que esquecer nem sobre o que discordar.
- **O gate deixa de ser `due_date === today`** (coluna que alguém mantém
  atualizada) e passa a ser "hoje casa com a regra de recorrência?"
  (`recurrence_cadence`, `recurrence_weekdays`, `start_date`) — dado estável.
- **`advanceFlowMold` deixa de existir como mutador de vencimento.** Com ele morre
  a classe de bug do avanço relativo a uma data velha, que aterra no passado e
  nunca mais casa com o gate estrito.
- **`automation_runs.occurrence_key` passa a ser o período**, não `today`. Hoje é
  `today`, e foi exatamente por isso que o redisparo manual de 21/09 colidiu com a
  linha gravada às 11:00. Com o período como chave, "a mesma semana duas vezes" é
  corretamente bloqueada e "outra semana" é naturalmente outra linha: semântica em
  vez de acidente.

## Race conditions

A regra que sustenta tudo é **identidade em vez de trava**.

| Corrida | O que protege | Muda? |
|---|---|---|
| Duas ocorrências ou etapas iguais | id determinístico + `insert … on conflict`; o código já tolera `23505` | Não — a propriedade se mantém, só a derivação muda |
| Dois tiques simultâneos (cron + disparo manual) | `automation_runs` único em `(config_id, occurrence_key, action)` + `claim_automation_run` atômico | **Sim, e é a correção**: a chave passa a ser o período |
| Humano agiu durante a geração | `transitionTaskStatus` compare-and-set no próprio UPDATE; `updateTaskPayload` atômico sob lock da linha; id de comentário idempotente | Não — é o que este código acertou; **não afrouxar** |

E a regra negativa, a mais importante:

> **Nunca reutilizar uma linha aberta.** A ocorrência nova é sempre uma linha nova.

Reutilizar foi o que forçou a cirurgia manual de 21/09 e é o que destruiria um
relatório sob revisão.

## Decisões

| Tema | Decisão | Consequência |
|---|---|---|
| Escopo | **Só o fluxo de relatórios** agora; recorrência global é frente separada (ver abaixo) | Duas derivações de id convivem por um período |
| Ocorrências abertas por cliente | **Sem limite** | Nunca bloqueia; um cliente esquecido acumula Entregas abertas, e isso fica visível |
| Status do molde com várias abertas | **A ocorrência mais recente** | O molde reflete o ciclo corrente; as atrasadas aparecem pelos próprios cards |
| Semanas passadas | **Só daqui pra frente**, sem backfill | Pendências antigas seguem abertas para aprovar ou abandonar à mão |

### Máquina de estados (já vale para os dois relatórios)

Confirmado em código: anúncios (`run.ts:261`→`292`) e conversão
(`conversionFlow.ts:745`→`760`) já fazem o mesmo ciclo, ambos como **North Ai**
(`AUTOMATION_ASSIGNEE`):

```
gera o PDF        → em_producao
anexa o PDF       → revisao
aprovação humana  → inicia a próxima etapa, ou conclui a Entrega
```

Ao anexar, o comentário **informa qual é a próxima etapa** — antes dizia o que foi
feito e não o que se espera de quem lê. A frase sai do workflow versionado da
ocorrência (`nextStepNotice.ts`), então reordenar etapas na tela de Etapas muda o
aviso sem tocar em código.

### Aprovação por comentário (futuro)

Um comentário que aprova deve, no futuro, aprovar — consta como pendência em
`decisoes.md`. Este desenho não a implementa, mas **já a habilita**: `approveTask`
(`lib/flows/approve.ts`) é o ponto único onde o compare-and-set e a cascata andam
juntos. Um parser de comentário chama essa função em vez de virar uma segunda
implementação de "aprovar" — duas implementações divergem, e foi assim que
"avançar o molde" divergiu em dois caminhos e custou quatro clientes.

As escritas de humano continuam entrando por `updateTaskGroup`, que já compartilha
a cascata entre o PATCH do admin e a aprovação do cliente. São duas portas com
donos distintos (humano e automação), não duas implementações da mesma regra.

## Estado da implementação — CONCLUÍDA em 22/09/2026

| # | O quê | Onde |
|---|---|---|
| 1 | Identidade da ocorrência = a DATA que ela cobre, com resolução do id legado (por ciclo) enquanto a ocorrência anterior estiver aberta | `automations/execute.ts` `ensureFlowOccurrence` |
| 2 | Gate por REGRA (`recurrenceOccursOn`) no lugar de `due_date === today`, nos dois pontos (pré-filtro do ledger e o gate de elegibilidade) | `recurrence.ts`, `automations/run.ts` `targetIsDue` |
| 3 | `occurrence_key` de `automation_runs` é o PERÍODO, garantido por o claim só acontecer depois do gate | `automations/run.ts` `claimDailyRun` |
| 4 | `advanceFlowMold` calcula a partir da ocorrência processada (absoluto), com filtro `due_date < nextDue`: idempotente e monotônico | `automations/execute.ts`, `flows/advance.ts` |
| 5 | Projeção do molde = ocorrência mais recente aberta | **já existia** em `project_parent_status` (`order by due_date desc`), e `recurringExecutionFields` grava `plan_id` |
| 6 | O agente informa a próxima etapa no comentário | `automations/nextStepNotice.ts` |
| 7 | Porta única de aprovação: compare-and-set + cascata numa função | `flows/approve.ts` `approveTask` |

Testes que fixam o comportamento: `automations/ocorrenciaPorPeriodo.test.ts` (o cenário
de 21/09 saindo, a transição do id legado, o avanço absoluto e monotônico),
`recurrenceOccursOn.test.ts` (inclusive a propriedade de que gate e agendador não
divergem), `flows/approve.test.ts`.

### O que NÃO mudou, de propósito

`materializeOccurrenceForReport` — o modo NORMAL, de cliente sem fluxo de
conversão — continua com id por ciclo. Ali o contador não é disputado: a própria
automação é a única escritora do molde, e avança no mesmo tique em que cria a
ocorrência. Trocar a chave lá seria mudança sem defeito que a motive, e entra na
frente separada abaixo.

## Frente separada: recorrência global

`recurringExecutionId` é keyed por ciclo em mais quatro pontos de
`lib/supabase.ts` (linhas 1932, 2136, 2396 e o caminho de datas explícitas em
1826), além do fluxo manual de conclusão de ciclo e das telas. Como o id é hash,
mudar a derivação muda **todo id futuro**; as linhas existentes mantêm os seus,
então os dois formatos precisam ser resolvidos durante a transição. Não há
cobertura e2e desse caminho hoje — por isso ficou fora deste escopo.
