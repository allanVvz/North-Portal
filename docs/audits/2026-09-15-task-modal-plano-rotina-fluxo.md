# Avaliação do modal de tarefa — Plano de Ação, Rotina e Fluxo (15/09/2026)

Pedido: "mais bonito, mais usual, menos informação e mais ação", com atenção à
criação de fluxos a partir do plano ("útil, mas a visualização está feia") e à
relação entre atividades, fluxos, planos e rotinas.

Método: prints em produção de três cards reais (Plano "Plano de conteudo",
molde de rotina "Relatório de anúncios — EXEMPLO", entrega "Evento Baita
19/09"), leitura do `TaskModal.tsx`, e as regras de `ui-ux-pro-max`
(progressive disclosure, uma ação primária por tela, sem rolagem aninhada,
alvos de toque ≥ 32–44px, cor nunca sozinha) e `dashboard-designer` (o que a
pessoa decide aqui, hierarquia, só o que é acionável).

## A relação entre os quatro

| Card | O que é | O que a pessoa faz no modal |
|---|---|---|
| **Plano de Ação** | Agrega atividades soltas e fluxos de um objetivo | Encher o plano e acompanhar as atividades |
| **Fluxo (Entrega)** | Etapas em cascata; o pai espelha a etapa atual | Mover a etapa atual (concluir, data, responsável) |
| **Rotina** | Molde que se repete; cada ciclo é um card | Concluir o ciclo e ver quem concluiu os anteriores |
| **Atividade/Etapa** | Card filho de um dos três acima | Editar na linha, sem abrir |

Os três "pais" repetem o mesmo padrão: **uma lista de filhos editáveis na linha
+ uma ação principal**. O modal agora trata os três assim.

## Achados e mudanças

### 1. Criar a partir do plano (o exemplo citado)

**Antes:** duas ferramentas empilhadas no fim da caixa de atividades:
- um bloco fixo "Plano de conteúdo", sempre aberto, com três campos numéricos
  (Reels/Anúncios/Carrosséis), um botão "+ Gerar etapas" e um parágrafo de
  instrução;
- abaixo, "+ Buscar ou criar atividade…", que ao criar abria um segundo
  formulário (Tipo, Responsável, Data, Cancelar/Adicionar).

Problemas: informação permanente para uma ação ocasional; dois lugares para a
mesma intenção ("pôr coisas no plano"); o formulário perguntava responsável e
data que a linha da atividade já edita; criar N cards de um tipo exigia N
formulários.

**Agora — `PlanAddCombobox`:** uma caixa de texto "Adicionar ao plano". Ao
clicar, abre a lista do que pode ser criado, cada opção com quantidade (− n +):
- **Vincular existente** — aparece ao digitar, com os cards soltos do cliente;
- **Conteúdos** — Reels, Anúncios, Carrosséis (viram as etapas agrupadas:
  roteiro, gravação, edição, aprovação, publicação);
- **Cards** — cada tipo criável; Entrega mostra "fluxo em cascata".

O que foi escolhido vira chip dentro da caixa ("3 Reels ✕", "2 × Entrega ✕") e
um único botão "Criar N" cria tudo. O rodapé diz o que vai nascer e de onde vêm
responsável e prazo ("Nascem com Allan · prazo a partir de 15/09"). Enter com
só um título cria uma tarefa. Fechado, o compositor ocupa uma linha.

### 2. Linhas de etapas e atividades (plano, fluxo e rotina)

**Antes:** cada linha tinha duas alturas — cabeçalho + uma fileira de campos com
rótulos em caixa-alta (STATUS / DATA PREVISTA / RESPONSÁVEL) — e um selo de
situação em toda linha, inclusive "No prazo".

**Agora:** uma linha só: check · título · status · data · responsável ·
comentários. Os rótulos viraram `aria-label`/`title`; os campos só mostram
borda no hover/foco. O selo aparece só quando pede ação (Atrasada/Parada);
concluída já está no check e no fundo da linha. Abaixo de 900px os campos
descem para a linha de baixo. Uma lista de 4 etapas ficou com metade da altura.

O ícone de comentário (emoji 💬) virou SVG, como o resto dos controles.

### 3. Rotina

**Antes:** duas caixas para a mesma pergunta — "Checks da recorrência (0)" e
"Execuções da recorrência (1)" — e a ação principal, "✓ Concluir ciclo", era um
botão fantasma no canto do rodapé, longe da lista que ela altera.

**Agora:** uma caixa. No cabeçalho, "Próxima entrega 21/09" e o botão primário
**✓ Concluir ciclo**; abaixo, as execuções (linhas editáveis) e os checks
(últimos 3, "Ver todos os N checks" expande — sem rolagem interna). Recorrência
encerrada mostra o aviso no mesmo lugar. Numa execução, os checks do molde
continuam aparecendo, só leitura.

### 4. Menos caixa vazia

A descrição vazia ocupava uma caixa inteira com um texto de instrução. Agora é
um link "+ Adicionar descrição" que abre o campo. A caixa de atividades mostra
"· N concluídas" ao lado da contagem.

## O que ficou de fora (próximos passos sugeridos)

- **Progresso do plano no cabeçalho**: o stepper Parada/Entrada/Em
  produção/Concluído do plano é herdado das tarefas comuns e diz pouco sobre um
  plano; uma barra "3 de 7 atividades" diria mais.
- **Agrupar atividades do plano por fluxo**: quando o plano tem entregas, as
  etapas de cada uma poderiam aparecer recolhidas sob a entrega.
- **Datas relativas nas linhas** ("em 3 dias", "há 2 dias") no lugar do
  `dd/mm/aaaa` do input nativo, com o seletor abrindo ao clicar.
