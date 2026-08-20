# Performance — templates, hierarquia e análise configurável

Status: implementado e validado localmente; release aguardando aprovação visual.

Atualizado em: 2026-08-20.

## Decisões finais da implementação

- O período permanece no controle nativo de calendário, fora do filtro.
- Há uma única caixa de filtro composto, igual às demais telas do portal. Seus
  atributos principais são `Template`, `Cliente`, `Categoria` e `Rede`.
- O seletor simples/paralelo de templates foi removido.
- Todo template personalizado novo é salvo com escopo `agency`; criação e
  atualização exigem gerente também no servidor. Não há opção pessoal na UI.
- Duas entidades selecionadas geram comparação por linhas sobrepostas, com
  legenda e cores distintas, nos níveis Campanha, Conjunto e Criativo.
- A limpeza da seleção é uma ação única `×`, vermelha, que limpa toda a cadeia
  hierárquica.
- A página usa largura máxima de 1512 px, 10% abaixo do layout largo de
  1680 px.

Este plano substitui o item de roadmap sobre templates em
`PERFORMANCE-CUSTOMIZACAO.md`. A base de customização já existe em produção:
período composto, filtros por cliente/categoria/rede, KPIs configuráveis,
métricas personalizadas, métricas dos gráficos e colunas da tabela. O próximo
passo é transformar essa configuração em visões nomeadas, aplicar a seleção de
entidades em todos os gráficos e completar a hierarquia da Meta Ads.

## 1. Diagnóstico da tela atual

O dashboard atual já permite mudar muita coisa, mas cada ajuste ainda parece
isolado:

- KPIs, tendência, top campanhas, donut e colunas têm controles diferentes.
- A preferência é uma única configuração global em
  `site_settings.performance_view_prefs`; não há versões nomeadas nem troca
  rápida entre configurações.
- O filtro composto conhece somente cliente, categoria e rede.
- A tabela agrega campanhas e expande diretamente para anúncios. Ainda não há
  o nível intermediário de conjuntos de anúncios (`adset`).
- Clicar numa linha apenas expande o detalhe; não existe seleção por checkbox
  nem um universo selecionado compartilhado pelos gráficos.
- A tendência aceita uma métrica por vez. Para análise operacional de
  WhatsApp, o mais útil é comparar investimento e conversas no mesmo eixo de
  tempo, com duas séries e escalas coerentes.
- Visitas ao perfil, novos seguidores e custo por seguidor não existem no
  contrato atual de `MetaPost`. Esses dados não devem ser inventados a partir
  de cliques ou alcance.

Princípio de produto: **template define a pergunta analítica; filtros e
seleções definem sobre quais entidades ela será respondida**.

## 2. Resultado esperado

No topo de Analytics haverá um seletor composto de template e um botão
`Salvar`.

Fluxo principal:

1. O usuário escolhe um template no campo composto pesquisável.
2. KPIs, filtros, nível da lista, colunas, ordenação e gráficos mudam juntos.
3. O usuário ajusta qualquer seção por dropdown/modal.
4. A tela marca o template como `Alterado` enquanto houver diferenças não
   salvas.
5. `Salvar` abre um dropdown bonito com:
   - campo `Nome do template`;
   - `Salvar alterações` quando o template for editável;
   - `Salvar como novo`;
   - opção de compartilhamento `Toda a equipe` ou `Somente eu`, se o usuário
     tiver permissão;
   - cancelar.
6. Templates nativos são somente leitura. Ao alterá-los, o botão oferece
   `Salvar como novo`.

O seletor deve mostrar inicialmente dois templates nativos:

- `Crescimento do perfil`;
- `Conversas no WhatsApp`.

Também deve listar templates personalizados, permitir busca por texto e
mostrar uma breve descrição/objetivo abaixo do nome. Não usar um `<select>`
nativo; reutilizar a linguagem visual dos dropdowns compostos do portal.

O mesmo template permanece ativo em todas as visões analíticas: `Visão geral`,
`Campanhas`, `Conjuntos de anúncios` e `Criativos`. Cada visão pode salvar seus
próprios cards, métricas e colunas dentro do mesmo template, mas todas usam os
mesmos filtros e a mesma seleção hierárquica. A aba operacional `Cards` não
entra nos cálculos analíticos; nela o template pode, no máximo, preservar
cliente/período para manter contexto, sem transformar tarefas em métricas.

## 3. O que um template salva

```ts
type PerformanceLevel = "campaign" | "adset" | "ad";
type PerformanceSource = "paid" | "organic";

type EntitySelection = {
  campaignIds: string[];
  adsetIds: string[];
  adIds: string[];
};

type ChartConfig = {
  id: string;
  type: "kpi" | "line" | "bar" | "donut" | "table";
  title: string;
  visible: boolean;
  source: PerformanceSource;
  metrics: MetricRef[];
  comparison?: "previous_period" | "none";
  sort?: { metric: MetricRef; dir: "asc" | "desc" };
  limit?: number;
};

type PerformanceTemplateConfig = {
  version: 1;
  period: { preset: 7 | 30 | 90 | "custom"; from?: string; to?: string };
  filters: {
    clientSlug?: string;
    category: "ads" | "organico" | "ambos";
    platforms: MetaPlatform[];
    objectives: string[];
    statuses: string[];
  };
  level: PerformanceLevel;
  selection: EntitySelection;
  charts: ChartConfig[];
  table: {
    visibleColumns: MetaPostMetricKey[];
    stickyIdentityColumns: boolean;
    density: "compact" | "comfortable";
  };
  customMetrics: CustomMetric[];
};
```

Regras:

- O template salva filtros, disposição analítica e seleções, mas nunca salva
  dados ou resultados calculados.
- IDs salvos que não existirem mais são ignorados e exibidos em um aviso
  discreto: `2 itens deste template não estão mais disponíveis`.
- Um template nativo salva objetivo/categoria, não IDs de campanhas reais.
- O período customizado pode ser salvo, mas o padrão recomendado para
  templates recorrentes é um preset relativo (`7`, `30` ou `90` dias).
- Se `Categoria = Ambos`, cada gráfico mantém sua fonte explícita. Dados pagos
  e orgânicos nunca são somados silenciosamente.
- Métricas personalizadas fazem parte do template para que ele seja portátil e
  não dependa da preferência global anterior.

## 4. Template nativo 1 — Crescimento do perfil

Objetivo analítico: verificar se campanhas voltadas a tráfego/visitas ao
perfil estão convertendo investimento em crescimento de audiência.

Filtro inicial:

- categoria: Ads, com cartões orgânicos complementares onde houver fonte;
- objetivos compatíveis: tráfego, engajamento/visitas ao perfil e equivalentes
  mapeados da Meta;
- nível inicial: Campanha;
- período inicial: 30 dias;
- rede inicial: Instagram, sem bloquear Facebook quando o usuário adicionar.

KPIs sugeridos:

1. Investimento;
2. Visitas ao perfil;
3. Cliques no link;
4. Novos seguidores;
5. Custo por seguidor = investimento / novos seguidores;
6. Conversas iniciadas.

Visualizações:

- tendência diária com `Investimento` e `Novos seguidores`;
- tendência diária secundária com `Visitas ao perfil` e `Cliques no link`;
- ranking por `Custo por seguidor`, com opção de inverter para melhor/pior;
- tabela hierárquica com objetivo, investimento, visitas ao perfil, cliques no
  link, seguidores, custo por seguidor e conversas;
- bloco de qualidade com CTR, CPC e frequência como métricas auxiliares.

Nota de dados: `visitas ao perfil` e `novos seguidores` só aparecem quando a
fonte suportar esses valores. Ausência é `—`, nunca zero. `Custo por seguidor`
só é calculado quando seguidores > 0 e investimento está disponível.

## 5. Template nativo 2 — Conversas no WhatsApp

Objetivo analítico: acompanhar campanhas de engajamento/mensagens cujo destino
é WhatsApp e identificar onde o custo por conversa está melhor ou pior.

Filtro inicial:

- categoria: Ads;
- objetivos compatíveis: mensagens, engajamento com mensagem e variações
  normalizadas da Meta;
- destino/plataforma: WhatsApp quando disponível;
- nível inicial: Campanha;
- período inicial: 30 dias.

KPIs sugeridos:

1. Investimento;
2. Alcance;
3. Conversas iniciadas;
4. Custo por conversa = investimento / conversas iniciadas;
5. Visitas ao perfil;
6. Novos seguidores.

Visualizações:

- gráfico principal de tendência com duas linhas: `Investimento` e
  `Conversas iniciadas por dia`;
- usar dois eixos Y, moeda à esquerda e quantidade à direita, sem normalizar
  visualmente séries de unidades diferentes;
- tooltip único por dia, mostrando investimento, conversas e custo por
  conversa daquele dia;
- ranking por menor custo por conversa, ignorando entidades sem conversa em
  vez de classificá-las artificialmente como custo zero;
- tabela hierárquica com objetivo, investimento, alcance, conversas, custo por
  conversa, visitas ao perfil e seguidores.

## 6. Hierarquia semelhante ao Meta Ads

A lista terá um seletor único de nível:

- `Campanhas`;
- `Conjuntos de anúncios`;
- `Criativos`.

Cada nível usa dados explícitos da API, sem inferir parentesco por nome:

```ts
type MetaPost = {
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  creativeId?: string;
  objective?: string;
  optimizationGoal?: string;
  destinationType?: string;
  // campos atuais...
};
```

Mudanças de coleta:

- generalizar o endpoint de detalhe para aceitar `level=campaign|adset|ad`;
- consultar Meta Insights com o nível solicitado;
- incluir `adset_id/adset_name` e metadados de objetivo/otimização/destino;
- manter o enriquecimento de criativo server-side, sem expor token;
- incluir nível, conta, período e filtros na chave de cache;
- preservar plataforma real no breakdown;
- não buscar todos os criativos de todas as contas no carregamento inicial:
  carregar sob demanda e armazenar cache por escopo.

No rótulo da UI, `Criativos` é a visão amigável; tecnicamente a linha é o
anúncio (`ad_id`) enriquecido com `creative_id`, thumbnail e metadados. Isso
evita juntar anúncios diferentes que reutilizam o mesmo asset mas têm entrega,
copy ou configuração diferentes.

## 7. Checkbox em cada item e filtro global

Toda linha da lista recebe um checkbox. O header recebe seleção de página e um
estado parcial (`indeterminate`).

Comportamento:

- nenhuma seleção: todos os itens compatíveis com os filtros alimentam os
  gráficos;
- uma ou mais seleções: todos os KPIs, gráficos, rankings e exportação passam
  a usar somente o universo selecionado;
- selecionar campanha inclui seus conjuntos e anúncios descendentes;
- selecionar conjunto inclui somente seus anúncios descendentes;
- selecionar criativo/anúncio inclui somente aquela linha;
- se houver seleções em níveis diferentes, usar união dentro do mesmo nível e
  interseção entre ancestral e descendente para evitar dupla contagem;
- exibir uma barra de contexto: `3 campanhas selecionadas · Limpar seleção`;
- mudança de cliente limpa seleções incompatíveis após confirmação apenas se
  houver alterações não salvas;
- o template pode guardar a seleção atual, mas templates nativos começam sem
  IDs selecionados.

Antes de renderizar qualquer gráfico, construir um único conjunto derivado:

```txt
dados brutos
  → período
  → cliente/conta
  → categoria/fonte
  → rede
  → objetivo/status/destino
  → seleção hierárquica
  → agregações de todos os cards e gráficos
```

Nenhum gráfico deve possuir um filtro paralelo próprio para entidade. A única
exceção é a fonte Pago/Orgânico por card quando `Categoria = Ambos`.

## 8. Configuração de todas as seções

Cada card/visualização ganha menu de três pontos com ações consistentes:

- `Configurar` abre modal;
- `Duplicar` cria outra visualização no template atual;
- `Ocultar` remove da tela sem apagar a configuração;
- `Mover para cima/baixo` inicialmente; drag-and-drop pode vir depois;
- `Restaurar padrão` para a configuração daquele card.

Modal de configuração:

- título editável;
- tipo de gráfico compatível com a quantidade/unidade das métricas;
- uma ou mais métricas;
- fonte Pago/Orgânico;
- comparação com período anterior;
- ordenação e limite para rankings;
- preview pequeno antes de aplicar;
- `Cancelar` e `Aplicar` claramente separados.

Regras de visualização definidas por análise de dados:

- linha: séries temporais; no máximo 3 séries para preservar leitura;
- barras: ranking de entidades; não usar para série temporal longa;
- donut: composição de um total; bloquear métricas com unidades distintas;
- dois eixos apenas quando as unidades forem diferentes e houver exatamente
  duas famílias de unidade;
- percentuais, moeda e volume mantêm formatadores próprios;
- alcance não é somado entre dias quando o dado é agregado por período;
- métricas indisponíveis ficam distintas das ocultas pelo usuário.

KPIs também terão modal/dropdown para escolher métrica, fonte, comparação e
formato. A tabela terá modal para colunas, densidade e ordem, preservando as
colunas de identidade sticky.

## 9. Filtros compostos

O campo de filtros passa a oferecer:

- Cliente;
- Categoria;
- Rede;
- Objetivo da campanha;
- Status de entrega;
- Campanha;
- Conjunto de anúncios;
- Criativo.

Campanha/conjunto/criativo usam busca com checkbox, seleção múltipla e contagem
de resultados. As opções são dependentes: escolher uma campanha reduz os
conjuntos disponíveis, e escolher um conjunto reduz os criativos.

Objetivos brutos da Meta devem ser normalizados para rótulos estáveis. Exemplo:
`OUTCOME_TRAFFIC`, variações legadas e otimizações compatíveis podem aparecer
sob `Tráfego`; o valor bruto continua disponível no detalhe/tooltip para
auditoria.

## 10. Persistência e permissões

Criar tabelas próprias, em vez de ampliar indefinidamente `site_settings`:

```sql
performance_templates (
  id uuid primary key,
  name text not null,
  description text,
  owner_profile_id uuid null references profiles(id),
  scope text not null check (scope in ('personal','agency','builtin')),
  config jsonb not null,
  schema_version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

Restrições:

- nome obrigatório, trim, 2–60 caracteres;
- nome único por owner/escopo, case-insensitive;
- templates `builtin` entram por migration e não podem ser alterados;
- admin editor cria/edita/exclui os próprios templates pessoais;
- gerente cria/edita/exclui templates da agência;
- todos os admins leem templates da agência e nativos;
- RLS e API validam a configuração com whitelist/versionamento;
- exclusão pede confirmação e nunca exclui template nativo;
- concorrência usa `updated_at` ou versão para não sobrescrever alterações de
  outra sessão silenciosamente.

Manter `performance_view_prefs` apenas como fallback durante a migração. Na
primeira abertura, convertê-la numa configuração transitória ou num template
`Visão anterior`; depois de uma janela de compatibilidade, remover a escrita
automática atual de 600 ms. Alterações passam a ficar locais até o usuário
clicar em `Salvar`.

Endpoints sugeridos:

- `GET /api/admin/performance/templates`;
- `POST /api/admin/performance/templates`;
- `GET /api/admin/performance/templates/:id`;
- `PATCH /api/admin/performance/templates/:id`;
- `DELETE /api/admin/performance/templates/:id`;
- `GET /api/admin/performance/entities?level=&parent=&client=&from=&to=`;
- generalizar `/api/admin/performance/insights/ads` para um contrato de
  hierarquia ou substituí-lo por `/insights/entities`.

## 11. Novas métricas e qualidade do dado

Adicionar ao catálogo, quando a fonte realmente disponibilizar:

- `profileVisits` — visitas ao perfil;
- `followers` — total de seguidores no fim do período;
- `followersGained` — novos seguidores no período;
- `costPerFollower` — derivada de investimento / novos seguidores;
- `costPerMessage` — derivada de investimento / conversas iniciadas.

Cuidados:

- total de seguidores é estoque; novos seguidores é fluxo. Não somar o estoque
  diário;
- atribuição de seguidores a uma campanha pode não existir na API. Nesse caso,
  mostrar seguidores como contexto orgânico da conta, não como resultado
  atribuído à campanha;
- visitas ao perfil de Instagram podem vir de insights orgânicos da conta e
  não da mesma consulta de anúncios;
- custo por seguidor por campanha só deve existir se houver evento atribuível
  de aquisição de seguidor. Caso contrário, limitar o cálculo ao nível da
  conta/período e explicar no tooltip;
- custo por conversa usa somente o action type canônico de conversa iniciada,
  sem somar aliases duplicados;
- guardar metadados de disponibilidade/proveniência por métrica para a UI
  explicar `Meta Ads`, `Instagram orgânico`, `calculada` ou `indisponível`.

Antes de liberar os dois templates com dados reais, executar uma auditoria das
contas conectadas para registrar quais métricas estão disponíveis por cliente,
plataforma e objetivo.

## 12. Estados e acabamento visual

- Skeleton do seletor e dos gráficos ao trocar template.
- Badge `Nativo`, `Equipe` ou `Pessoal` no dropdown.
- Badge `Alterado` e aviso ao trocar de template com mudanças não salvas.
- Estado vazio específico: sem dados, sem métricas na fonte, seleção vazia ou
  entidade removida são mensagens diferentes.
- Dropdowns fecham por outside-click e Escape; modais prendem foco e restauram
  foco ao fechar.
- Mobile: filtros e ações em drawer; tabela mantém identidade e permite scroll
  horizontal; modais ocupam a tela com footer fixo.
- Não usar apenas cor para seleção: checkbox, fundo e texto de contexto.
- Todas as ações têm rótulo acessível e navegação por teclado.

## 13. Ordem de implementação

### Fase A — fundação de templates

1. Extrair o estado completo do dashboard para um `PerformanceTemplateConfig`
   versionado e sanitizado.
2. Criar migration, RLS e CRUD de templates.
3. Semear os dois templates nativos.
4. Implementar seletor composto, estado `Alterado` e dropdown de salvar.
5. Migrar/fazer fallback da preferência global existente.

### Fase B — hierarquia e seleção

1. Ampliar contrato Meta com campanha, conjunto e anúncio/criativo.
2. Generalizar coleta/cache por nível.
3. Implementar seletor de nível e tabela única.
4. Adicionar checkbox por linha e motor central de seleção hierárquica.
5. Conectar o universo selecionado a KPIs, gráficos, rankings e CSV.

### Fase C — configuração de todos os gráficos

1. Criar menu comum de card e modal comum de configuração.
2. Suportar múltiplas séries e dois eixos na tendência.
3. Permitir duplicar, ocultar, reordenar e restaurar cards.
4. Aplicar validações por tipo/unidade de métrica.

### Fase D — métricas de perfil e templates finais

1. Auditar disponibilidade real nas fontes conectadas.
2. Implementar visitas ao perfil/seguidores com proveniência explícita.
3. Implementar custo por conversa e, somente onde válido, custo por seguidor.
4. Ajustar os dois templates nativos com dados reais.

### Fase E — validação e release

1. Unitários do sanitizador, métricas derivadas e seleção hierárquica.
2. Integração de CRUD/RLS e compatibilidade de versão dos templates.
3. E2E: criar, nomear, salvar, trocar, editar e excluir template pessoal.
4. E2E: template da agência disponível para outro admin.
5. E2E: checkbox de campanha/conjunto/criativo altera todos os gráficos e CSV.
6. E2E real Meta: valores conferem por nível, objetivo e período.
7. Validação visual desktop/mobile e acessibilidade de dropdowns/modais.
8. Typecheck, testes, build, migration, deploy e smoke em produção.

## 14. Critérios de aceite

- Há dois templates nativos selecionáveis no dropdown composto.
- `Salvar` abre o campo de nome e salva um novo template reutilizável.
- Trocar de template aplica de uma vez filtros, nível, seleção, KPIs, gráficos,
  métricas, colunas e ordenação.
- Todos os cards e gráficos têm configuração consistente por modal/dropdown.
- A lista alterna entre campanha, conjunto e criativo com dados reais da Meta.
- Cada linha possui checkbox e a seleção afeta todas as visualizações e o CSV.
- Objetivo de campanha pode ser filtrado e faz parte dos templates nativos.
- A tendência do template WhatsApp mostra investimento e conversas por dia.
- Custo por conversa não divide por zero nem trata ausência como zero.
- Seguidores/visitas ao perfil exibem proveniência e não são falsamente
  atribuídos a campanhas quando a fonte não oferece essa atribuição.
- Templates inválidos/antigos degradam para defaults seguros e não quebram a
  tela.
- Permissões pessoais/agência e RLS são comprovadas por testes.

## 15. Fora de escopo desta rodada

- edição colaborativa simultânea em tempo real;
- compartilhamento público por link;
- IA sugerindo ou alterando templates automaticamente;
- drag-and-drop avançado de grid antes dos controles simples de ordem estarem
  estáveis;
- atribuir seguidores a anúncios por aproximação estatística sem fonte
  oficial.
