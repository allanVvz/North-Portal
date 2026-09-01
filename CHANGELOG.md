# Changelog

## 31 de agosto de 2026 — relatório de anúncios redesenhado + fluxo de conversão / vendas

Branch `feat/relatorio-conversao-vendas`. Duas frentes: (0) reescrever o
relatório PDF da automação para parecer o resumo que a equipe manda à mão, e
(1) fechar o ciclo de conversão com um fluxo de 2 cards + IA lendo o comentário.

### Fase 0 — Relatório de anúncios por bloco de objetivo

- **KPIs agrupados por tipo de campanha** (Tráfego para o site / Tráfego para o
  perfil / Mensagens / Engajamento / Outras), cada bloco com suas métricas
  próprias. A classificação é uma **tag manual por campanha** no template de
  Performance (`config.campaignBlocks`); `suggestCampaignBlock` (objective +
  optimization_goal + nome da campanha) dá só o palpite inicial.
- **Lista de criativos abaixo de cada campanha** (agregados por `adId` entre
  plataformas) com coluna de **fonte #1/#2/#3** (`config.adSourceTags`, tag
  manual por anúncio) e de **Mensagens** (`contatos`, unificado msg/lead/conversa
  pelo maior). Conta Windsor ou sem detalhe → "sem detalhe por criativo".
- **Funil agregado por último**; `funnelStageCount` derruba a etapa de cauda sem
  dado (ex.: "Seguidores") em vez de faixa tracejada, na tela e no PDF.
- **Sem o gráfico de linha diário**; **gauges fora do padrão** dos 3 builtins
  (`hiddenSections: ["gauges"]`).
- **`instagram_profile_visits` passa a ser ingerido** (schema Meta v6):
  "Visitas ao perfil" agora tem dado real; `followersGained` segue vazio — a
  Marketing API não expõe follows.
- Componentes de PDF compartilhados extraídos para `lib/reports/reportComponents.tsx`.
- A automação passa a buscar dados **por criativo** (fan-out
  `fetchMetaAdCreativeInsights` por campanha). Relatório cabe numa folha A4
  (teto de 6 campanhas × 3 criativos).

### Fase 1 — Fluxo de conversão (2 automações)

- **Tipo-entrega `relatorio_conversao`** (migração `20260901000000`): 2 etapas —
  `relatorio_trafego` (a automação preenche e **auto-conclui**) → `agendamentos`
  (manual, cliente-visível). 5º `TaskKind`.
- **Automação 1 estendida**: alvo = molde de entrega recorrente
  `relatorio_conversao` → preenche a etapa de tráfego, auto-conclui,
  `reconcileFlows()` cria a etapa de agendamentos na sequência
  (`ensureFlowOccurrenceForReport` / `advanceFlowMold`; guarda em
  `materializeFirstStep` contra molde recorrente).
- **`lib/ai/`** — primeiro código que fala com um LLM no repo. `fetch` direto na
  Messages API da Anthropic, sem SDK, sem deps. `getAiProviderSettingsService`
  (leitura service-role da credencial `provider='ai'`), `aiComplete`,
  `extractConversionReport` (texto livre → linhas de conversão; pré-check regex
  para "N agendamentos"; **nunca lança** — sem chave / IA fora / resposta
  ilegível → pede de novo).
- **Automação 2 `relatorio_vendas`** (chave nova, migrações `20260901000100`
  CHECK + `20260901000200` unique `(target_task_id, automation_key)`):
  `runAutomations()` despacha por chave. A cada tique lê o comentário do
  responsável na etapa `agendamentos`, extrai as conversões com IA, grava em
  `task_metrics` (`source='cliente'`, escalares string) + `payload.conversoes`,
  auto-conclui a etapa; com a etapa de tráfego concluída → gera **`salesReportPdf`**
  (resumo do período, tabela por fonte #1/#2/#3 cruzando receita × custo do
  anúncio, funil de vendas), anexa na ocorrência, `settleDelivery` encerra.
  Ambíguo → comentário-pergunta, etapa fica aberta, nunca `parada`.
- Validado ponta a ponta contra CRIS CAR CARE em produção
  (`scripts/relatorio-conversao-e2e.mjs` + `lib/automations/e2e.manual.test.ts`).

## 30 e 31 de agosto de 2026 — criação de tarefa, Trilhas North, recorrência v2

Três frentes definidas pelo usuário (R0.1–R0.3 no `plan/ROADMAP.md`) e uma
faxina no modelo de tarefas.

### R0.1 — Um botão só de criação de tarefa (`a8f4a7b`)

Os 6 pontos que abriam o modal de criação com props diferentes viraram **um
botão idêntico em toda tela** (`NewTaskButton`). O que nasce é decidido pelo
**tipo escolhido no modal**, não pela tela de origem. Escolher uma Entrega e
deixar em "Fluxo completo" monta a corrente inteira; escolher um subtipo
(`scope=flow-step`) cria só aquele card, solto.

### R0.2 — Trilhas North é uma lista global (`4527e2b`→`dd0d0cc`)

Antes: o admin subia um HTML por cliente na tabela `documents` e o portal do
cliente lia um array escrito à mão — os dois lados não conversavam. Agora existe
a tabela **`north_trilhas`** (global, igual pra todo cliente): o admin adiciona
apresentação HTML **ou vídeo do YouTube**, reordena por arraste, e o portal lê a
mesma lista na mesma ordem. "Visualizar" abre a trilha embutida num modal estilo
card de documento. O Manual do Cliente virou uma linha dessa lista.

### R0.3 — Recorrência v2 + higiene do modelo de tarefas (`589d803`, `5148cb7`, `0971717`)

**Recorrência:**
- **Sem data-limite.** Uma recorrência avança a cada conclusão manual, pra
  sempre, e **só encerra quando o card-pai (o molde) vai para Aprovado ou
  Parada**. Encerrada, o botão "Concluir ciclo" some e a automação de relatório
  para de gerar.
- **Toda tarefa pode ser recorrente — Entrega inclusa.** Antes o servidor
  recusava; agora cada ciclo de uma Entrega recorrente materializa uma
  entrega-ocorrência própria com sua primeira etapa.
- **Dia da semana virou opcional.** Sem marcar nada, a recorrência fica no
  mesmo dia da semana em que começa.
- Corrigido: ao trocar o tipo de "Rotina" para outro, a recorrência não fica
  mais grudada (dava erro ao salvar uma Entrega).

**Modelo de tarefas (migração `20260831120000`):**
- `kind`/`subtype` agora são validados contra o vocabulário — um valor com typo
  não entra mais no banco.
- **Revisão e Aprovação** são amarradas 1:1 à tela **Configurações › Etapas**:
  etapa desligada para o cliente → o campo Revisor/Aprovador some do modal e do
  "Configurar atributos". Sem exceção manual.
- `payload` do card ganhou schema: chave desconhecida é descartada antes de
  gravar.

### Correções de teste

- `e2e/client-approval-flow.spec.ts` rodado e verde contra o backend real.
- `e2e/commercial-checkpoints.spec.ts` consertado (estava vermelho desde a
  fusão do `/admin/onboarding` na aba Onboarding de Informações).

---

## 20 a 30 de agosto de 2026

Dez dias de trabalho, 75 commits. As três frentes maiores foram **Entregas**
(peça de conteúdo virou uma corrente de etapas), **Performance** (Analytics e
Aquisição unificados, funil redesenhado) e uma leva de **acabamento visual** no
admin, no site público e no calendário. Também entraram capa automática nos
cards, navegador de pastas do Drive, bússola única com favicon, foto de perfil
coerente em toda a plataforma e a tela de Leads.

---

## Detalhado por frente

### Fluxos em cascata / Entregas — recurso novo, em produção desde 29/08

Uma peça de conteúdo deixou de ser um card único e passou a ser uma **corrente de
etapas** (Roteiro → Captação → Edição → Publicação), cada uma um card próprio com
responsável, prazo, comentários e anexos.

- **Motor de cascata** (`c39bf7c`) — terceiro eixo de "card-pai", ao lado de
  Plano de Ação e Rotina. Concluir uma etapa cria a próxima sozinho;
  `reconcileFlows()` na cron diária garante a corretude.
- **Criar e acompanhar na interface** (`fe1c80c`, `5afa036`) — botão
  "+ Nova entrega", pill que escolhe o molde, caixa "Etapas do fluxo" no modal,
  selo `2/4 · Captação` no card, aba **Operação › Entregas** (reusa a tela do
  Plano de Ação). Ao concluir uma etapa, o modal mostra "Próxima etapa criada"
  com um clique para abrir.
- **Uma porta de criação, vocabulário único, elos N:N** (`bd1cbb0`) —
  "+ Nova tarefa" e "+ Nova entrega" viraram um botão só; o Tipo decide o que
  nasce. O vínculo entre cards virou N:N (`task_links`): o mesmo roteiro serve
  várias peças sem duplicar card.
- **Cinco tipos, um funil só** (`ef89c86`) — Tarefa, Plano, Entrega, Checkpoint
  e Rotina, só esses. `agendamento`/`planejamento` desativados e seus cards
  viraram Tarefa. Todas as etapas terminam em "Concluído"; **"Publicado" saiu do
  funil** — no portal do cliente o pill verde "Publicado" virou "Concluído".
- **Publicar é um card** (`92c1911`) — as 24 peças históricas viraram o card de
  Publicação, sem inventar cards sintéticos.
- **Entrega recorrente** (`2e0ac4e`) — cada ocorrência agora materializa a
  primeira etapa sozinha, em vez de ficar parada em 0%.
- **"Parada" virou a primeira coluna** (`88f8f42`), não a última — é onde um card
  trava quando uma automação falha.
- **Acabamento do modal** (`d682216`, `dcbfe6d`, `ca8e659`, `9d5d6e1`, `9b554b2`,
  `187cfb4`) — rodapé 52% mais baixo, etapa "Parada" em vermelho só quando o card
  está parado, seletor de corrente de volta pra dentro do modal (estava
  transparente e no canto), "Criado em" 20% menor, e a Entrega passou a
  contribuir para o progresso do Plano de Ação em todas as telas.

### Notificações — 29/08

- **Regras de verdade no servidor** (`df9c4e7`) — a tela Configurações ›
  Notificações não configurava nada (eram interruptores em `localStorage` que só
  filtravam a exibição). Viraram cinco regras globais da agência no banco.
  Passaram a **notificar de fato**: comentário do cliente no portal, comentários
  de automação, criação de card e a cascata de fluxo. O revisor deixou de receber
  notificação duplicada ao entrar em Revisão.
- **Atribuir revisor voltou a funcionar** (`0edc88a`) — bug de produção desde
  26/08: pôr um card em Revisão com revisor atribuído dava erro e não salvava.
- **Regras deixaram de ser endpoint público** (`364e97a`) — duas funções
  auxiliares ficaram acessíveis sem login por descuido numa migração; fechado.

### Performance / Funil de aquisição — 20 a 28/08

- **Analytics e Aquisição unificados** (`4668496`, `b734b87`, `420fda2`) — um
  filtro composto só, uma tabela Campanhas/Conjuntos/Criativos só, um sistema de
  templates só para as duas telas. **Aquisição virou a aba padrão.** Templates
  por etapa de funil (Funil completo / Topo / Fundo). Corrigido bug de
  agregação: a Tendência diária somava CTR/CPC/CPM em vez de recalcular.
- **Um desfecho por template** (`a43ca19`) — os builtins assumiam "lead" como
  desfecho de toda campanha; o dado real desmente (94 leads × 1.311 conversas ×
  340 compras). Três templates, um por desfecho. Métricas sem integração passaram
  a dizer "Sem integração" em vez de "—".
- **Funil desenhado a partir do dado** (`d091a06`, `e287b20`, `0c7a738`,
  `4df8ffa`, `1b7e96c`, `7dc375e`, `e55e01b`) — o cone 3D azul decorativo virou
  SVG proporcional às razões reais (escala logarítmica, +15%, números por fora).
  Leads e conversas iniciadas viraram um par de cards comparáveis lado a lado; o
  box final consolida os dois desfechos com custo médio ponderado.

### Capa dos cards + navegador do Drive — 23 e 27/08

- **Capa automática nos cards** (`06705bb`, `d7e178d`, `e8aa72f`) — um card de
  conteúdo agora mostra a peça: imagem ou frame de vídeo puxado do link do Drive
  que já estava na descrição ou num comentário. Funciona sem conta de serviço e
  tenta mais de um arquivo até algum responder.
- **Capa no modal e no painel do card** (`80e0b18`, `cb16104`), em faixa, atrás
  do cabeçalho; modal 10% maior.
- **Navegador de pastas do Drive** (`bb4a4e0`, `ffaa506`, `7758829`, `691fda4`,
  `0ff8f8d`) — cadastro do cliente, visão do cliente e card agora navegam dentro
  das pastas (e subpastas), com trilha de navegação. Pasta colada num comentário
  abre prévia. No card, pasta e anexos viraram um bloco só, **"Materiais"**.
- **Prévia inline de Drive/Docs/Sheets/Slides** em descrições e comentários
  (`6eec388`).

### Identidade visual — 27/08

- **Bússola única em toda a plataforma** (`19deae1`, `57afdaa`, `eaa324d`) — a
  barra lateral do admin tinha um "N" de texto, o site um círculo riscado, o
  login um ponto com gradiente, e não havia favicon. Agora é uma rosa dos ventos
  só, monocromática, que se adapta ao contexto, **com favicon**. Portal do
  cliente e tela de recuperar senha entraram na marca única.

### Foto de perfil — 27/08

- **Foto coerente nas cinco telas** (`cb5df35`) — a foto de Minha conta agora
  aparece na barra lateral, nos comentários de tarefa e em Equipe & papéis; antes
  só em dois lugares. Iniciais unificadas (primeiro + último nome).
- **Foto do autor do comentário exata** (`b8aa813`) — passou a gravar o id do
  autor, não só o nome.

### Equipe / Quem Somos — 26/08

- **Cargo, responsabilidades, bio e foto real** (`3c5db3e`) — `profiles` ganhou
  cargo/bio/avatar; matriz de responsabilidades
  (edição/captação/roteiro/métricas/aprovação) em Equipe & papéis. **"Quem Somos"
  no site passou a listar os sócios reais** (Alisson, Cintia, Luiza) em vez de
  "Nome em validação".
- **Upload de foto via rota de servidor** (`ea398f4`) — o bucket rejeitava todo
  upload direto por RLS; contornado.

### Site público — 26/08

- **Home restaurada** (`7eb3e65`, `669e287`, `703306d`) — o merge do redesign
  deixou a home renderizando praticamente **sem estilo em produção**; as classes
  da home antiga não existiam no CSS novo. Restaurado, e corrigidos textos
  cortados em "Resultados que importam" e "Princípios que aparecem no trabalho".
- **CTA de diagnóstico e tema claro/escuro** (`383ae7d`) — "Solicitar
  diagnóstico" não fazia nada em /planos, /quem-somos, /como-funciona e na home.
  O redesign também removera o botão de tema claro/escuro do site; devolvido.

### Leads / Landing pages — 26 e 28/08

- **Tela de Leads** (`e52c376`) — o formulário de /lp gravava em `public.leads`
  desde 15/08 e nenhuma tela lia (havia um lead de 27/08 que ninguém vira). Nova
  tela em /admin/clientes: kanban por status (arrastar move) e tabela por faixa
  de investimento. "Converter em cliente" leva ao cadastro pré-preenchido.
- **Aba Landing Pages em Configurações** (`2ad34dd`).

### Rotinas — 26/08

- **Drag and drop nas três views de Operação · Rotinas** (`965d1bd`) — arrastar
  move de cliente, reatribui responsável, ou define a próxima execução no
  calendário.

### Admin — cadastro e Home — 26/08

- **Cadastro de cliente v2** (`19fe7c3`) — seções compartilhadas entre
  criar/editar, escopo por chips, checkpoints selecionáveis, vínculo de conta de
  anúncios, integração Drive. Nova tela **"Ver cliente"** (grid do Instagram,
  prévia de pastas, checkpoints em timeline). Menu voltou a ser lista plana;
  **"Tarefas" virou "Operação"**.
- **Editar e excluir comentário** no card, inline, com marca "editado"; coluna de
  comentários ~10% mais larga (`d65009b`).

### Calendário — 30/08

- **Grade regular no telefone** (`22a1532`) — as semanas do mês tinham alturas
  muito diferentes (a maior 3,3× a menor) e as colunas não alinhavam; um card de
  nome longo alargava a própria coluna. Agora as sete colunas são iguais, o
  título quebra em até duas linhas, e no telefone a pílula vira um traço colorido
  para o mês inteiro caber sem rolar.

### Menu mobile do admin — 30/08

- **Menu vira gaveta** (`90e6c6c`) — no celular o menu inteiro ficava sempre
  aberto no topo (~190px em toda página). Agora a barra tem só marca, botão de
  menu e sino; o resto abre numa gaveta que fecha ao navegar, ao tocar fora e no
  Escape.
- **Seis correções de interface** (`983586c`) — capa dos cards no quadro virou
  faixa de 96px (era 396px e pagava rolagem), "Início" deixou de aparecer como
  "Iníci" no mobile, "Remover" cliente virou "Ocultar", carimbo de atualização do
  card virou "há 3 d".
- **Botão do menu só no mobile** (`1545465`) — estava vazando no desktop.

### Infra / testes

- Lockfile do npm sincronizado com o CI (`0773e13`, `0bac5fc`).
- Testes e2e da Home do admin reescritos para a tela que existe (`3b2cb99`).

---

## Resumo em linguagem simples — o que qualquer um percebe usando

### O que ficou diferente no quadro de tarefas (Operação)

- **A aba "Tarefas" agora se chama "Operação"**, e dentro dela há três abas:
  Tarefas, Entregas e Rotinas.
- **Os cards do quadro agora têm capa.** Se alguém colou um link do Google Drive
  (imagem ou vídeo) na descrição ou num comentário do card, essa peça aparece
  como uma imagem no topo do card — dá para reconhecer o card de longe, sem
  precisar abrir. A mesma capa aparece dentro do card aberto.
- **Novidade "Entregas": um criativo virou uma sequência de cards.** Em vez de um
  único card "Criativo" que passava por várias fases, agora existe uma corrente:
  Roteiro → Captação → Edição → Publicação, cada etapa é um card com seu próprio
  responsável e prazo. O card que está "a bola da vez" aparece no quadro com um
  selo tipo `2/4 · Captação`. A entrega inteira e o quanto ela já andou ficam na
  aba Operação › Entregas. Quando você conclui uma etapa, o card mostra um atalho
  "Próxima etapa criada" para já abrir a seguinte.
- **A coluna "Parada" mudou de lugar.** Ela é onde um card cai quando uma
  automação dele falha. Estava no fim da fila (parecia a última fase); agora é a
  primeira coluna, e só aparece quando há algum card parado.
- **Dá para editar e apagar seus próprios comentários** no card (aparece um
  menuzinho no canto do comentário). Comentário editado mostra "editado".
- **O card aberto ficou mais enxuto:** o rodapé com os botões encolheu quase pela
  metade, e a linha "Criado em" ficou menor — sobra mais espaço para a conversa.
- **Pasta do Drive dentro do card:** agora você navega pelas subpastas ali
  mesmo, com trilha de navegação, e pasta + anexos ficam juntos num bloco só
  chamado "Materiais".
- **No portal do cliente**, a etiqueta verde "Publicado" agora diz "Concluído".

### Calendário

- **No computador** as semanas do mês ficaram todas com a mesma altura e as
  colunas alinhadas (antes umas semanas ficavam gigantes e outras espremidas
  quando um card tinha nome comprido). O nome do card agora quebra em duas linhas
  em vez de cortar com "...".
- **No celular** o mês inteiro cabe na tela sem rolar: cada tarefa vira um
  tracinho colorido pela cor do tipo. Para ver os títulos, use a visão de Semana.

### Menu do admin no celular

- Antes o menu inteiro ficava aberto o tempo todo no topo de toda página,
  ocupando quase um quinto da tela. **Agora vira uma gaveta:** no topo ficam só a
  marca, o botão de menu (☰) e o sino. Toca no botão, a gaveta abre; ela fecha
  sozinha quando você navega, quando toca fora, ou aperta Esc.
- No computador nada mudou — o menu lateral continua igual.

### Performance (relatórios de anúncios)

- **"Analytics" e "Aquisição" viraram uma tela só.** Um filtro só, uma tabela só,
  um conjunto de modelos (templates) só, valendo para as duas. **Aquisição é a
  aba que abre por padrão.**
- **O funil foi redesenhado.** Era um desenho de cone 3D azul, decorativo. Agora
  é um funil de verdade, com a largura de cada etapa proporcional aos números
  reais da campanha, e os valores escritos ao lado.
- **Leads e "conversas iniciadas" aparecem lado a lado** como dois resultados
  comparáveis (volume, custo por unidade, taxa de conversão), e no fim há um
  fechamento que soma os dois e mostra o custo médio por resultado.
- Cada modelo de relatório agora sabe qual é o "desfecho" que aquela conta
  persegue (mensagem, compra, ou misto) — antes tudo era tratado como "lead",
  mesmo quando a conta nem gerava leads.
- Métrica que nenhuma integração alimenta agora diz **"Sem integração"** em vez
  de um traço, para você não ficar procurando um filtro errado.

### Clientes

- **Nova tela "Leads"** dentro de Clientes: todo mundo que preenche o formulário
  da landing page (/lp) agora aparece aqui, em quadro (arrastar move de estágio)
  ou em tabela ordenada por verba. O botão "Converter em cliente" abre o cadastro
  já preenchido com os dados que a pessoa enviou.
- **Cadastro de cliente refeito:** o mesmo formulário serve para criar e para
  editar, com escopo por etiquetas, escolha de checkpoints e vínculo de conta de
  anúncios.
- **Nova tela "Ver cliente":** grade do Instagram do cliente, prévia das pastas
  do Drive e os checkpoints numa linha do tempo.
- O botão **"Remover" cliente virou "Ocultar"** (porque ele nunca apagou nada de
  verdade, só escondia).

### Rotinas

- Agora dá para **arrastar rotinas** nas três visualizações de Operação ·
  Rotinas: arrastar entre colunas de cliente troca o cliente, entre colunas de
  responsável reatribui, e no calendário define a próxima execução.

### Marca e foto de perfil (toda a plataforma)

- **Um símbolo só — uma bússola** — no admin, no site, no login e no portal do
  cliente, e agora existe **favicon** (o iconezinho na aba do navegador). Antes
  cada tela tinha um rabisco diferente.
- **Sua foto de perfil agora aparece em todo lugar:** barra lateral do admin,
  nos comentários das tarefas e na lista de Equipe & papéis. Antes só aparecia em
  "Minha conta" e em "Quem Somos" — quem trocava a foto achava que não tinha
  salvado.

### Equipe / site público

- **"Quem Somos" mostra os sócios reais** (Alisson, Cintia, Luiza) com cargo,
  descrição e foto, no lugar dos três "Nome em validação".
- Em **Equipe & papéis** dá para definir o cargo de cada pessoa e marcar as
  responsabilidades (edição, captação, roteiro, métricas, aprovação).
- **A home do site estava sem estilo em produção** (um merge tinha quebrado o
  CSS) — voltou ao normal. Textos que estavam cortados em "Resultados que
  importam" e "Princípios que aparecem no trabalho" foram arrumados.
- **O botão "Solicitar diagnóstico" voltou a funcionar** nas páginas /planos,
  /quem-somos, /como-funciona e na home (antes só funcionava na /lp).
- **O botão de tema claro/escuro voltou** ao site público (o redesign tinha
  tirado).

### Correções que se notam no dia a dia

- **Colocar um card em Revisão com revisor definido voltou a funcionar** — desde
  26/08 isso dava erro e a alteração não salvava.
- **As notificações passaram a chegar de verdade.** Antes quase nada gerava
  notificação; agora comentário do cliente no portal, criação de card e o avanço
  de uma corrente de etapas avisam quem está envolvido. O revisor parou de
  receber o mesmo aviso duas vezes ao entrar em Revisão.
- A tela **Configurações › Notificações** agora realmente liga e desliga cada
  tipo de aviso para a agência inteira (antes era só um filtro que valia só
  naquele navegador).
