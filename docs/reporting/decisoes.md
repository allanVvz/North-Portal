# Histórico de decisões — relatórios

Registro das decisões dos dois relatórios automáticos (anúncios e resultados), em ordem.
Cada linha diz o que foi decidido e por quê. O detalhe de implementação mora em
`report-pipeline.md`, `comment-parser.md`, `report-design-system.md` e
`adaptive-report-plan.md`.

## Arquitetura da pipeline

| Data | Decisão | Por quê | Alternativa descartada |
|---|---|---|---|
| 14/09 | Duas automações distintas em cascata: anúncios (API do Meta) e resultados (feedback humano) | Perguntas, fontes e gatilhos diferentes; o relatório de resultados não é continuação visual do de anúncios | Uma automação só com as duas partes |
| 14/09 | A dependência é atributo declarado (`automation_configs.depends_on_config_id`) | Antes era deduzida por "as duas no mesmo card", e rodava calada quando a dedução falhava | Co-locação implícita |
| 14/09 | Resultados só rodam sobre a revisão **final** do relatório de anúncios (`traffic_reports`) | Comentário feito durante a revisão do tráfego disparava o relatório de vendas sobre o PDF v1 | PDF existente bastar como gatilho |
| 14/09 | Registros `traffic_reports` (revisão, snapshot) e `conversion_reports` (reivindicação com índice único) | Idempotência contra cron em dobro, retry e hook concorrente; os dois PDFs da semana leem a mesma mídia | Marcadores só no payload |
| 14/09 | Ausência ≠ zero em toda a cadeia (extração, `task_metrics`, resumo, PDF) | Zero gravado por ausência vira "receita caiu 100%" na semana seguinte | Tratar não informado como 0 |
| 14/09 | Fluxo com revisor espera a aprovação; sem revisor, a geração já é final | Os 6 moldes não têm revisor; o ritmo deles não muda | Exigir revisão sempre |

## Conteúdo e storytelling

| Data | Decisão | Por quê |
|---|---|---|
| 14/09 | Relatório de resultados abre na conversão mais importante informada: receita/vendas > agendamentos > seguidores | Um motor atende a Baita (só seguidores) e a CRIS (vendas) sem automação por combinação |
| 14/09 | CTR, CPC e CPE só aparecem quando críticos (custo unitário ≥ +30%) e sempre explicados em frase | Métrica técnica é difícil para o cliente |
| 15/09 | Nota técnica só quando o custo do **resultado** do objetivo também piorou (≥ +10%) | "Engajamento 305% mais caro" ao lado de "menor custo por conversa" confundia |
| 15/09 | Seguidores são resultado real: número grande, funil até o total do perfil | O cliente de seguidores não tinha protagonista no relatório |
| 15/09 | Funil sempre presente e trapezoidal, escala log, largura nunca crescente; taxa só entre etapas da mesma fonte | Proporção legível (23 não some ao lado de 16.429) sem mentir sobre causalidade |
| 15/09 | Funil usa os **mesmos** cliques da faixa de números; visita ao site não fica entre cliques e conversas | Havia 417 no funil contra 404 na faixa; a conversa não sai do site |
| 15/09 | No máximo 1 alerta; uma nota metodológica no rodapé; pouca metalinguagem | Excesso de avisos dilui o que importa |
| 15/09 | Histórico pelo número de semanas: 1 = nada, 2 = "antes → depois", 3+ = gráfico | Gráfico de 2 pontos não conta nada que a comparação não diga |
| 15/09 | Em seguidores, a comparação de 2 semanas sai quando só repete a figura principal | "1.214 → 1.251" aparecia três vezes |
| 15/09 | Tabela comparativa por objetivo preservada; campanhas só quando há mais campanhas que objetivos | É o que o gestor usa para decidir verba |

## Criativos

| Data | Decisão | Por quê |
|---|---|---|
| 15/09 | Criativos com preview real: miniatura 600 px pelo nó do criativo | `thumbnail_url` padrão vem 64 px; `image_url` é vazio em vídeo |
| 15/09 | Imagem **baixada** na geração e guardada no storage; o relatório de resultados relê do storage | A URL assinada do Facebook expira em dias |
| 15/09 | Uma chamada por criativo, 6 em paralelo | O lote `?ids=` foi aposentado pela Meta ("deprecated in v26.0+") e deixava todo relatório sem imagem |
| 15/09 | Até 2 selos por criativo, nunca "Estável"; link "ver post" | Selo que não diferencia é ruído |

## Design

| Data | Decisão | Por quê |
|---|---|---|
| 15/09 | Números em Inter; Fraunces só no título | Fraunces não tem "→"/"↑" e cansa em tabela |
| 15/09 | Séries ordenadas numa matiz só (teal em degraus) | O validador de paleta reprovou 4 cores (croma baixo, ΔE 11,6 < 15) |
| 15/09 | CTR na faixa do topo só para conta de tráfego para o site | Nas demais contas não é o desfecho |
| 15/09 | Paginação livre; título de seção preso ao primeiro bloco | `minPresenceAhead` não segurava título sozinho no pé da página |
| 15/09 | Rótulo do gráfico do lado oposto ao da linha; folga maior embaixo | "R$ 185,40" cruzava a linha |

## Operação

| Data | Decisão | Por quê | Alternativa descartada |
|---|---|---|---|
| 17/09 | Relatórios às **08:00 BRT** (cron `0 11 * * *` em UTC), cobrindo o período configurado | Horário canônico da operação; a Entrega e o primeiro relatório permanecem em Entrada até a execução começar | Marcar o parent em produção antes de a primeira etapa iniciar |
| 15/09 | Ocorrência do fluxo usa o ciclo seguinte ao do molde | O ciclo atual colidia com a ocorrência do modo normal da semana anterior | — |
| 17/09 | Comentário de Feedback usa **modelo** e parser determinístico; OpenAI é fallback opcional e explícito (`COMMENT_AI_FALLBACK=1`) | A automação normal não depende de IA. A credencial OpenAI é o único provider acionável hoje e sua falha nunca aprova, conclui ou duplica dados | IA lendo texto livre como caminho padrão ou fallback obrigatório |
| 15/09 | Comentário fora do modelo recebe resposta com o modelo, uma vez por comentário | Fechar como "não informado" diria que ninguém respondeu | Fechar a semana com nulos |
| 15/09 | Fluxo de exemplo (`payload.report_example`) não grava `task_metrics` | Números ilustrativos apareceriam como resultado real em Performance | — |
| 14/09 | Gatilho do parser barato: R$ 10 devem gerar mais de 60 relatórios | Teto de custo explícito | — |

## Custo medido (15/09)

Par da semana sem IA ≈ US$ 0,0002 (≈ R$ 0,001). Com a IA lendo o comentário: até
≈ R$ 0,017 por comentário. Tabela em `report-pipeline.md` → Custo por geração.

## Pendências conhecidas

- Resumo da automação no card escreve "Receita: 4100" sem formato de moeda.
- Aprovação determinística do Feedback por comentário de revisor (hoje a
  aprovação continua manual).
- Atribuição de receita por fonte no relatório de anúncios (hoje só no de resultados).
