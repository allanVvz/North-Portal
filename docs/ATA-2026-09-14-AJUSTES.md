# ATA 14/09 — ajustes para a entrega de 16/09

O que cada item da reunião virou na plataforma, onde mora, e o que ficou de fora.

## Situação das tarefas

| Pedido | O que foi feito | Onde |
|---|---|---|
| Todas as tarefas com status PARADA, ATRASADA, CONCLUÍDA, NO PRAZO | Situação derivada, uma regra só: concluída = `aprovado`; parada = `parada`; atrasada = data prevista vencida e não concluída; no prazo = o resto | `app/admin/deadlineState.ts` |
| Atraso = data prevista de cada etapa × status diferente de concluído | A mesma regra, aplicada a cada card — cada etapa de um fluxo é um card com a própria data | idem |
| Concluídas MAIS VISUAIS, bloco inteiro grifado, em todas as visões | Bloco verde no quadro, tabela, calendário, rotinas, Entregas/Planos e linhas de etapa | `app/globals.css` (seção "Situação do prazo") |
| Atrasadas grifadas em vermelho | Bloco vermelho com faixa lateral; parada em âmbar | idem |
| Quadro: status primeiro \| data de entrega \| responsável \| cliente | Linha de situação no topo do card; depois título; depois prazo, responsável e cliente | `app/admin/KanbanBoard.tsx` |
| Filtro de demandas ATRASADAS | Filtro "Situação" na barra de busca + botão "Atrasadas N" ao lado | `KanbanSearchBar.tsx`, `KanbanBoard.tsx` |
| Ordenar por data evidencia o atraso e esconde concluídas | Ordem "Data" tira as concluídas do quadro e de Entregas/Planos; o atraso sobe por ser a data mais antiga | `KanbanBoard.tsx`, `ParentCardsBoard.tsx` |

## Home de cada pessoa

| Pedido | O que foi feito |
|---|---|
| Paradas e em atraso na tela inicial do responsável | Bloco "Paradas e atrasadas" com os cards da pessoa (vínculo de perfil ou nome no responsável), parada primeiro |
| Citações e pautas aguardando retorno na Home | Bloco "Aguardando sua resposta": a última @menção à pessoa num card, enquanto ela não comentar depois |
| Recorrentes consideradas na visão inicial | Bloco "Suas rotinas desta semana" (vencidas ou nos próximos 7 dias) |

`lib/supabase.ts` → `listMyHomeFocus`; `app/admin/home/AdminHome.tsx`.

## Comentários

| Pedido | O que foi feito |
|---|---|
| Citar o @ da pessoa | Autocomplete "@" com a equipe no campo de comentário (modal e painel); a menção é grifada; quem foi citado recebe a notificação `task_mentioned` |
| Comentários das RECORRENTES somados | O molde e todos os ciclos mostram o mesmo histórico (`lib/comments.ts → familyCardsOf`) |
| Plano de conteúdo e demais demandas: comentários separados por etapa, ícone na linha | 💬 com contador em cada etapa/atividade: abre os comentários daquela etapa e comenta nela sem abrir o card |

`app/admin/MentionTextarea.tsx`, `app/api/admin/tasks/[id]/comments/route.ts`, `app/admin/StepRow.tsx`.

## Etapas no card (referência do Monday)

Cada etapa de fluxo e cada atividade de plano aparecem no card com: check de concluir,
situação, **status** (dropdown), **data prevista** (editável) e **responsável** — sem abrir
o card. A etapa atual é marcada, e é ela que o card pai espelha. Etapas que ainda não
nasceram (a cascata cria quando a anterior conclui) aparecem com o prazo previsto.

`app/admin/StepRow.tsx`, `app/admin/FlowStepsBox.tsx`.

## Demandas recorrentes

| Pedido | O que foi feito |
|---|---|
| Sempre aberta, com data futura | "Concluir ciclo" avança até a primeira data depois de hoje, mesmo com semanas de atraso |
| Ciclos concluídos registrados com data e quem finalizou, no card | "Checks da recorrência": data do check, ciclo e quem deu, no molde e em cada execução (`payload.cycle_log`) |
| No calendário e demais visões | As datas futuras de cada rotina aparecem no calendário do quadro (mês e semana), além da tela de Rotinas |
| Notificação para agendar (ex.: diária de gravação) | O cron das 9h avisa os responsáveis 2 dias antes de cada rotina vencer; moldes de relatório automático ficam de fora |

`lib/cycleLog.ts`, `lib/supabase.ts → completeTaskCycleForRequest`, `lib/automations/routineReminders.ts`,
`app/api/admin/routines`.

Ciclos concluídos antes de 15/09 não têm autor registrado — o sistema só guardava a data do último.

## Cadastro de cliente

As rotinas padrão — Assinatura de contrato, Reunião de kickoff, Onboarding, Acompanhamento
semanal, Reunião mensal — são a etapa final do cadastro. O botão "Criar cliente" só libera com
data e responsável de todas, e a API recusa com 400 se faltar alguma. As três únicas viram
tarefa; semanal e mensal viram demanda recorrente. O card genérico de kickoff deixou de nascer.

`lib/clientRoutines.ts`, `app/admin/novo/NewClientForm.tsx`, `app/api/admin/clients/route.ts`.

## Plano de conteúdo

No card de Plano de Ação, "Plano de conteúdo" pergunta quantos Reels, anúncios e carrosséis e
gera as etapas agrupadas pelo volume: roteiro do bloco, uma gravação para os vídeos, edição por
formato, design dos carrosséis, aprovação do cliente e publicação — com datas a partir do início
do plano. As etapas viram atividades do plano, editáveis na linha.

`app/admin/contentPlan.ts`, `app/admin/ContentPlanComposer.tsx`.

## Relatórios automáticos (fluxo da Luiza)

As etapas de relatório nascem com quem cuida do tráfego (Equipe & papéis: Allan e Luiza), não
com "North ai" — entram na Home, no quadro e no atraso de quem executa. Fluxo e prazos em
`docs/reporting/report-pipeline.md` → Responsável das etapas.

## Jornada do admin conferida em produção (15/09)

Prints tirados em `northportal.vercel.app` depois do deploy, sem salvar nada:

- **Home**: os três blocos novos aparecem (7 paradas/atrasadas, 2 menções aguardando
  resposta, rotinas da semana). Os títulos saíam cortados ("FLU…") com três colunas
  estreitas — corrigido para duas colunas de no mínimo 420px e título em até duas linhas.
- **Quadro**: situação como primeira informação, bloco vermelho nas atrasadas, atalho
  "Atrasadas 79" e as concluídas ocultas na ordenação por data, com o aviso na coluna.
- **Nova tarefa**: o modal de criação herdava a altura fixa do card aberto (três campos no
  topo de uma tela vazia) e o ✕ ficava solto no meio do cabeçalho — corrigido: o modal de
  criação acompanha o conteúdo e o ✕ vai para o canto.
- O restante da jornada (troca de tipo, plano de conteúdo, etapas na linha) não foi
  fotografado: o Chrome travou três vezes ao capturar com o modal aberto, por falta de
  memória na máquina. Validado por testes e typecheck, não por print.

## Fora desta rodada

- As etapas do plano de conteúdo são atividades de Plano de Ação, não uma cascata: a próxima não
  nasce sozinha quando a anterior conclui. Todas existem desde o início, com a data prevista.
- A notificação de menção não tem interruptor próprio em Configurações › Notificações (tipo novo
  nasce ligado).
- Rotina cujo responsável é só texto (sem conta vinculada) não recebe o aviso de agendamento.
