# Performance — calendário composto e customização do painel

Status: base implementada em produção em 2026-08-19. A próxima fase de
templates, hierarquia Campanha → Conjunto → Criativo e seleção global está em
`PERFORMANCE-TEMPLATES-HIERARQUIA.md`.

Relacionado: [[PERFORMANCE-ORGANICO]] (aba Orgânico), e as fases 2-4 já descritas em
`memory.md` (handoff de 2026-08-18: período exato reaproveitando `CalendarPicker.tsx`,
personalização do painel, seletor de nível campanha/conjunto/anúncio). Este arquivo
**não substitui** esse handoff — acrescenta os detalhes de UX pedidos em 2026-08-19 que o
handoff anterior ainda não cobria (redesenho do calendário em si, customização fina do
dashboard, filtro de cliente/campanha). Ler os dois juntos antes de implementar.

## Calendário — de 2 boxes para 1 box com 2 meses

Hoje (conforme a fase 2 do handoff) o plano era só trocar os presets fixos por um período
exato reaproveitando `CalendarPicker.tsx`. O pedido de hoje refina o *design* desse
seletor:

- Em vez de 2 boxes separadas (uma por mês, ou uma por data), **1 box só**, com **2
  calendários lado a lado**, cada um com o cabeçalho mostrando o mês que representa (ex.:
  "Agosto 2026" | "Setembro 2026").
- Reproduzir o mesmo design visual do calendário usado no modal de atividade
  (`app/admin/TaskModal.tsx`, via `CalendarPicker.tsx`) — não criar um componente visual
  novo do zero.
- A box comporta seleção de 1 data única ou de um range (múltiplas datas), igual ao
  `CalendarPicker` já suporta (`value`/`endValue`/`onChange`/`onEndChange`).
- **Diferença em relação ao calendário de tarefas**: aqui não existe seletor de
  recorrência — usar `recurrenceFeatureEnabled={false}` como já registrado na fase 2 do
  handoff.
- O seletor de datas só deve aparecer dinamicamente quando o toggle de período estiver em
  "Custom" (ver abaixo) — fica escondido nos outros presets.
- Essa versão do calendário deve ser construída para poder ser **reincorporada** em outros
  lugares do produto depois (ex.: o range composto pedido para a tela de Plano de Ação em
  [[PLANO-DE-ACAO-VIEW-ESTRATEGICA]]) — extrair como componente compartilhado, não deixar
  acoplado só à tela de Performance.

## Toggle de período — 4 opções

Trocar os 3 botões fixos (`7`, `30`, `90` dias) por 4: `7`, `30`, `90`, **`Custom`**. Só ao
selecionar `Custom` o campo de data (1 box/2 calendários acima) abre para escolher 1 ou 2
datas. Presets continuam sendo atalho — o comportamento de aplicar/validar intervalo já
descrito na fase 2 do handoff (`from`/`to` em `YYYY-MM-DD`, impedir fim antes do início,
limite máximo, fuso `America/Sao_Paulo`) vale igual para o valor produzido pelo `Custom`.

## Customização do painel (KPIs, tabela, filtros)

Amplia a fase 3 do handoff (`PerformanceViewSettings`, persistida em `site_settings` chave
`performance_view_prefs`) com os itens pedidos hoje:

- **Todo KPI do header deve poder ser escondido individualmente** (hoje só o 4º card do
  bloco de KPIs — `div.perf-kpis > div:nth-child(4)` — não tem controle; o requisito é
  generalizar para os N cards, não resolver só esse).
- **"Top campanha" por alcance deve poder trocar a métrica** (ex.: para engajamento) — e o
  mesmo vale para **"engajamento dos anúncios"**, que deve aceitar outras métricas
  configuráveis, não só a fixa atual.
- A configuração salva vale para **todas as views da tela**, inclusive o export (CSV) e
  qualquer consumo futuro por IA/card de automação (ver [[AUTOMACOES-IA-HARNESS]]) — uma
  única fonte de verdade de preferências, não uma por artefato.
- **Dropdown de cliente**: hoje está com um visual próprio e "feio" — trocar pelo mesmo
  componente/estilo já usado nas telas de Operação (reaproveitar, não redesenhar do zero).
- **Filtro composto** (caixa de texto + dropdown) deve ganhar o mesmo tratamento visual
  (`border-radius`, composição) das outras telas que já têm esse padrão — ver
  [[PLANO-DE-ACAO-VIEW-ESTRATEGICA]], que descreve a versão "correta" desse componente.
- Escopo do filtro: cliente é o nível que se **salva**; campanha/conjunto/anúncio são
  **filtrados** dentro do cliente selecionado, não persistidos como preferência global.

## Tabela "Campanhas" — espaçamento, colunas fixas, nível único

- Espaçamento entre colunas deve ser **ajustável pelo usuário, mas fixo/igual para todos**
  os usuários depois de ajustado (não por-sessão).
- Manter uma versão das colunas **mais compacta e sempre visível** (sticky), próxima da
  borda, para não perder contexto ao rolar.
- Hoje a tabela tem um dropdown de campanhas separado das colunas — trocar por **um
  seletor único de nível** (Campanha | Conjunto de anúncios | Anúncio), poupando colunas
  redundantes. Isso já está desenhado na fase 4 do handoff (`level: "campaign" | "adset" |
  "ad"`) — este item só confirma que o seletor de nível deve substituir, não coexistir
  com, o dropdown de campanhas solto.
- Sliders da lista (paginação/quantidade) devem ficar **no topo**, não no rodapé, com o
  mesmo estilo visual dos sliders coloridos já usados nos cards de tarefas de clientes.

## Seleção cria gráfico próprio + overlay nos outros

- Ao selecionar uma campanha (ou, no nível certo, um conjunto/anúncio) na lista, criar o
  gráfico correspondente no box daquele nível.
- Mesmo comportamento para conjuntos de anúncios e criativos/anúncios.
- Quando algo está selecionado: a linha na lista se colore, **e os gráficos dos outros 2
  níveis abaixo recebem overlay/destaque** do resultado selecionado, sem alterar os dados
  já filtrados nesses gráficos (é uma camada de destaque por cima, não uma refiltragem).
- O overlay se adapta ao critério de métrica escolhido (item de customização acima) —
  trocar a métrica visível também troca o que é destacado no overlay.

## Roadmap — promovido para próxima fase

Criar integração para templates de painel customizáveis (o usuário monta e salva um layout
próprio) tornou-se prioridade em 2026-08-20. O desenho completo está em
`PERFORMANCE-TEMPLATES-HIERARQUIA.md`.
