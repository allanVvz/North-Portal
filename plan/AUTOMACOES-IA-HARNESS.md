# North Portal como harness multiagente de IA — plano geral de expansão e escalabilidade

Status: planejado, não implementado (exceto onde citado como "já entregue"). Última
atualização: 2026-08-19.

Este é o documento geral que amarra as frentes soltas de feedback a uma visão única: **a
plataforma vira uma agência de orquestração de agentes de IA especializados em marketing**,
construída sempre sobre a arquitetura de cards já existente
([[task-model-v2]] — `kind`/`subtype`/`plan_id`/`recurrence_cadence`), nunca um modelo
paralelo. Ele parte do roadmap já registrado em `memory.md` (RoadMap, itens 1-6,
2026-08-19) — **não depreciado** — e incorpora o feedback novo desta rodada.

## Base já registrada em `memory.md` (RoadMap, não depreciada)

`memory.md` é local (gitignorado) e é hoje a fonte viva de handoffs/roadmap deste projeto.
Resumo do que já estava lá antes desta rodada, para não se perder:

1. **Notificações individuais por acesso** — greenfield confirmado (sem tabela/rota/UI).
   Bases prontas: `task_assignees`, `reviewer_id`/`approver_id`, realtime já habilitado em
   `public.tasks` (`lib/useTaskRealtime.ts`). Ponto de ancoragem sugerido:
   `.admin-topline-actions` em `AdminShell.tsx` — **confirmado nesta rodada** como o local
   certo (ver seção "Shell administrativo" abaixo, o pedido de hoje pede exatamente um
   dropdown ali, abrindo à direita do rail).
2. **Papel "gestor de tráfego"** — modelo atual é `user_role` enum (`admin`/`client`) +
   `profiles.level`. Um papel novo deve ser **atributo aditivo**, não um 3º valor do enum
   (trocaria o CHECK de `level` e todas as policies).
3. **Tela de tarefas prioritárias/da semana** — passar pelo Figma antes de produção.
4. **Integrações IA no dropdown de Configurações** — ponto de extensão já existe
   (`tab === "integracoes"` em `SettingsPanel.tsx`, hoje só `MetaIntegration`/
   `WindsorIntegration`). Chaves via cofre (`vault_set_secret`/`vault_read_secret`,
   `lib/vault.ts`) — **o CHECK de `provider` só aceita `'windsor'`/`'meta'` hoje, precisa de
   migration** para os provedores de IA. Confirmado novamente nesta rodada (ver "Telas de
   integração mock" abaixo — é por isso que a primeira versão fica só em estado local/mock,
   sem gravar no cofre ainda).
5. **Tela de automações/harness de IA** — fluxo: analisar métricas (campanha → conjunto →
   anúncio, já existe desde 2026-08-18) → gerar relatório recorrente por cliente → popular
   card recorrente com o relatório em PDF. Pré-requisito (vincular arquivo a um card) só
   existe hoje em Documentos.
6. **Gaps a validar**: login individual com notificação direcionada desktop/mobile;
   revisor notificado quando a tarefa entra em revisão (`reviewer_id` já existe).

## Princípio arquitetural (pedido explícito desta rodada)

Toda automação, checkpoint ou notificação futura **respeita a arquitetura de cards já
existente** — nunca cria um sistema paralelo:

- Card é sempre `tasks` com `kind`/`subtype` do catálogo (`lib/taskCatalog.ts`).
- Plano é sempre `kind=plano_acao` + membros por `plan_id`.
- Rotina é sempre `recurrence_cadence` em cima de um card existente, não uma tabela nova.
- Pontos de extensão futuros (estado de contato/lead, card de automação, card de criativo,
  card de ads com origem de dado rastreada) são **colunas/tabelas aditivas**, documentadas
  antes de implementadas — ver o exemplo concreto em [[CHECKPOINTS-COMERCIAIS]].

## Shell administrativo — rail, tema, notificações (auditoria feita nesta rodada)

Ver detalhamento completo (arquivos, linhas, mecânica) no plano de execução da branch
`feat/ui-shell-mocks`. Resumo do que muda:

- Notificações: dropdown novo, ancorado em `.admin-topline-actions` (topo do rail), abrindo
  **à direita** do rail — primeiro artefato visual do item 1 do roadmap acima. Mock nesta
  rodada; trilha paralela de backend real entrega a API que substitui o mock depois.
- Tema claro/escuro: sai do topo do rail, entra no dropdown de perfil (`.admin-account`),
  entre o cabeçalho e "Configurações".
- Botão de esconder o rail é removido; rail passa a auto-esconder/mostrar no hover da
  lateral (só desktop — mobile mantém layout atual).
- Comentários de card (`TaskModal.tsx`/`TaskDetailPanel.tsx`) passam de `<input>` para
  textarea multilinha: Enter envia, Shift+Enter quebra linha, texto maior com leitura mais
  confortável (reaproveita `AutoGrowTextarea` já existente).

## Automações configuráveis — arquitetura completa

Tudo configurável na aba **Automações** de Configurações, um dropdown por automação:

- Cada automação tem: **modelo** (provedor/LLM selecionável — ver "Telas de integração
  mock" abaixo), **system prompt**, **user prompt**, e **contexto**. Todos com **defaults
  padrão para todos os clientes**, alteráveis por cliente a partir do próprio contexto do
  cliente (cadastro/briefing/plano de ação).
- **Prompts são configuráveis na tela** de Configurações, salvos e atualizam o card em uso.
- **Contexto** não vive em Configurações — vive em Plano de Ação/cards reais: cada contexto
  individual é uma **tarefa recorrente** ("quais métricas são importantes para esse
  relatório", "quais gráficos devem estar") cujo card filho, a cada recorrência, vira uma
  **nova versão** desse contexto (histórico versionado).
- Cada automação tem um **plano de ação versionado** por release da automação (mudança de
  prompt/config = nova versão registrada, não sobrescrita silenciosa).
- Toda automação tem como finalidade final **um card**: escreve nos campos de texto do
  card, reprocessa a partir dos comentários (cada novo comentário dispara uma nova
  compilação usando o comentário como referência adicional), e conclui quando aprovado.
  Enquanto em desenvolvimento, o card mostra "**em produção**" no próprio indicador de %.
- Setup inicial: no cadastro do cliente, instruir a responder o briefing e abrir o plano de
  ação de cada agente com informações default já preenchidas.

### Telas de integração — mock nesta rodada, real depois

Duas telas mockadas na branch `feat/ui-shell-mocks` (`SettingsPanel.tsx`, tab
`integracoes`):

- **Provedor de IA**: dropdown com Anthropic/ChatGPT/DeepSeek (mock de campo de API key +
  lista de modelos). Real depois da migration do CHECK de `provider` (item 4 do roadmap
  acima) — a versão mock não grava no cofre.
- **Google Drive**: mock de conexão + preview placeholder. Uso real futuro: preview de
  imagens/vídeos de uma pasta do Drive diretamente no card (comentários e descrição, no
  mesmo lugar onde um link já é colado hoje).

### Agentes de IA planejados (visão futura, não implementados)

- **Bia — Copywriter**: perfil de agente de IA cadastrado em Configurações (nome + foto,
  hoje mock). Acionada automaticamente quando um card `criativo` é movido para
  "concluído": propõe uma legenda considerando atributos do card (data, posicionamento,
  formato) e a anexa com o perfil dela nos comentários.
- **Agente de social media plan**: acionado assim que uma legenda é aprovada nos
  comentários de uma tarefa concluída. Questiona campos faltantes (data/hora do post),
  sugere melhores horários usando dados internos, e pode se basear no briefing + histórico
  de cards/resultados.
- Futuro: mover um card criativo para "publicado" deve ser suficiente para publicar de
  fato o conteúdo (ads ou orgânico) — vínculo de publicação real com suporte a publicar
  diretamente na plataforma. Ver também [[PERFORMANCE-ORGANICO]] para o modelo de dados de
  orgânico que essas métricas vão alimentar.

### Providers alternativos (roadmap, não implementado)

- Toggle para selecionar provedores oficiais alternativos.
- Open API — para GET em sistemas como Google Maps, scraping de páginas autorizadas.
- Gateway multi-modelo — API para usar tokens de múltiplos modelos de IA em um só lugar.

## Orquestração de execução (como este plano é implementado, não o produto em si)

Pedido explícito do usuário: desenho/planejamento com Opus, execução com Sonnet 5,
validação e2e com Opus alimentando fixes de volta para múltiplos agentes Sonnet, em loop.
Aplica-se a partir da branch `feat/ui-shell-mocks` em diante — ver seção "Orquestração
multi-agente" do plano de execução desta etapa.

## Índice dos outros documentos desta rodada

- [[PERFORMANCE-ORGANICO]] — Anúncios/Orgânico/Cards como abas separadas, sem somar dados.
- [[PERFORMANCE-CUSTOMIZACAO]] — calendário composto, KPIs ocultáveis, seletor de nível.
- [[INFORMACOES-TRILHAS]] — toggle Documentos/Jornada/Relatórios, Trilhas, onboarding.
- [[PLANO-DE-ACAO-VIEW-ESTRATEGICA]] — filtro composto correto, calendário de range.
- [[CLIENTES-BOTAO-CADASTRO]] — botão de criação só em Cadastro.
- [[CHECKPOINTS-COMERCIAIS]] — checkpoint como tarefa/rotina/plano/plano+rotinas.
