# Reanálise dos dashboards — Home e Operação (15/09/2026)

Feita com o método do skill `dashboard-designer` (público e decisão primeiro,
3–5 KPIs acionáveis com comparação, hierarquia em F, títulos que dizem o que
está acontecendo, vermelho só para problema real, data de atualização visível).

## Home (`app/admin/home/AdminHome.tsx`)

**Quem abre e para quê.** Uma pessoa da equipe, todo dia, para decidir "o que eu
resolvo primeiro". É um painel operacional pessoal, não um painel da agência.

| Problema encontrado | Por que era ruim | O que mudou |
|---|---|---|
| Lista "Paradas e atrasadas" com `max-height: 360px; overflow: auto` | Barra de rolagem dentro do card (o "slider vertical feio"); rolagem aninhada esconde itens e compete com a rolagem da página | Nenhuma lista rola por dentro. Mostra as 6 primeiras e um link "+ N outras no quadro →" que abre a Operação já filtrada (`?situacao=atrasada`) |
| KPIs eram da agência (semana, atrasadas, progresso de planos) e ficavam abaixo das listas | O número mais importante para a pessoa (o que é dela) não aparecia no topo; KPI sem comparação | Quatro KPIs pessoais no topo: minhas atrasadas (com o total da agência como comparação), minhas paradas, aguardando minha resposta e minhas entregas na semana (com quantas vencem hoje). Cada um leva à tela que resolve |
| Subtítulo "N cards esperam você" contava revisão/aprovação da agência | Não respondia a pergunta da Home | Frase-resposta no topo: "Você tem 3 tarefas atrasadas, 1 parada e 2 menções esperando resposta." |
| Três blocos de foco com o mesmo peso, lado a lado | Sem hierarquia: a lista acionável tinha o mesmo tamanho das rotinas | Layout em F: a lista "N tarefas suas pedem ação" ocupa a coluna larga; menções e rotinas ficam na coluna lateral |
| Títulos-rótulo ("Paradas e atrasadas", "Esta semana") | Não diziam o que está acontecendo | Títulos com o número e o sentido ("4 tarefas suas pedem ação", "Esta semana na agência · 12") |
| Blocos vazios sumiam sem explicação | Quem nunca foi mencionado não sabe que o bloco existe | Estado vazio explicativo ("Quando alguém escrever @Allan num card, aparece aqui até você responder") |
| Sem data de atualização | Não dá para saber se o número é de agora | Rodapé "Atualizado às HH:MM" |

Os números da agência continuam, em uma linha de contexto logo abaixo dos KPIs
(atrasadas, entregas da semana, progresso dos planos, fila de revisão).

## Operação / Quadro (`app/admin/KanbanBoard.tsx`, `KanbanSearchBar.tsx`)

| Problema encontrado | O que mudou |
|---|---|
| O atalho "Atrasadas N" era um botão solto na barra de ferramentas, ao lado da caixa de busca, com um estado "ligado" próprio | O atalho vive **dentro** da caixa de pesquisa e filtro. Clicar nele vira o chip "Situação: Atrasada" — o mesmo chip de qualquer filtro, removível pelo ✕. Enquanto o filtro está ligado, o atalho some (o chip já diz o que está filtrado) |
| A Home não tinha como abrir o quadro filtrado | `?situacao=atrasada` (ou `parada`, `no_prazo`, `concluida`) na URL abre o quadro com o chip já aplicado |

Pontos já corretos e mantidos: filtros no topo, contagem por coluna, ordenar por
data esconde concluídas e destaca atrasadas, cor de situação com texto (nunca só
cor).

## Modal de tarefa criada (`app/admin/StepRow.tsx`)

Achado em produção (card "Evento Baita 19/09"): nas etapas ligadas, a linha com
check, situação, título, 💬 e desvincular **não aparecia** — só os campos de
status/data/responsável, sem dizer de qual etapa eram. Causa: a linha usava a
classe `.tm-step-line`, que já é o traço do stepper do cabeçalho
(`position: absolute; height: 2px; z-index: -1`). Renomeada para
`.tm-steprow-head`.

## Pendências conhecidas

- A Home não se atualiza sozinha (só as notificações são em tempo real). Para
  um painel diário isso é aceitável; o rodapé diz a hora dos números.
- "Minhas entregas na semana" conta por responsável (vínculo de perfil ou nome
  no campo texto), a mesma regra de "minhas atrasadas".
