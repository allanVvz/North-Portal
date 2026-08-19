# Tela de Informações — toggle Documentos / Jornada / Relatórios

Status: planejado, não implementado.

Relacionado: [[task-model-v2]] (plano de ação como card real, `kind=plano_acao`,
`plan_id`), [[CHECKPOINTS-COMERCIAIS]] (onboarding é um checkpoint),
[[AUTOMACOES-IA-HARNESS]] (quem popula a aba Relatórios).

## Toggle global (3 estados)

A tela de Informações ganha um toggle on/off igual ao já usado nas outras telas do admin,
mas com **3 estados** (não 2): `Documentos` ↔ `Jornada` ↔ `Relatórios`. O terceiro estado
(`Relatórios`) é a integração ponta a ponta com as automações — ver seção própria abaixo.

## Jornada — box "Trilhas" no lugar de Briefing

Ao mudar o toggle para `Jornada`, o box hoje chamado "Briefing" é renomeado e substituído
por **"Trilhas"**:

- Cada documento, apresentação ou vídeo anexado a uma trilha mede progresso de forma
  simples (ex.: visualizado/não visualizado, ou % de conclusão quando o formato permitir).
- Cada trilha está relacionada a um card **criado automaticamente** a partir do documento
  no momento em que ele é anexado — não é um registro solto, é sempre um card real no
  modelo de [[task-model-v2]].
- Esse card tem o **cliente como responsável**. Pode ser uma tarefa recorrente (raro) ou,
  mais comumente, um **plano de ação** (`kind=plano_acao`) quando a trilha tem várias
  etapas/anexos.
- **Onboarding é um plano de ação**, um por cliente, com os cards criados automaticamente
  a partir dos checkpoints comerciais — ver detalhamento em
  [[CHECKPOINTS-COMERCIAIS]] (o onboarding padrão hoje é: assinatura do contrato, manual
  do cliente, briefing + reunião de alinhamento inicial — 3 tarefas).

## Backend — documento HTML incorporável + link público de progresso

- Um novo documento HTML poderá ser incorporado por **drop-in** (colar/soltar o arquivo)
  ou selecionado de um arquivo já existente (reaproveitar o padrão de upload já usado em
  Documentos — ver `lib/documentFiles.ts`, branch `feat/documentos-storage`).
- Ao incorporar, o HTML passa a ter um **link acessível publicamente por cliente**,
  mostrando o progresso de cada cliente ao concluir cada trilha (visão externa, sem login
  admin — no espírito do portal do cliente já existente em `app/[slug]`).
- Com isso, "onboarding" deixa de ser um conceito solto e vira **o grupo/plano de ação do
  cliente** que contempla especificamente Manual do Cliente + Briefing (os dois documentos
  centrais do onboarding), reaproveitando a mesma trilha/progresso.

## Relatórios (3º estado do toggle)

- Tela semelhante à de Documentos, expondo os **relatórios gerados pelas automações**
  (não editáveis manualmente — são output de automação).
- A automação que os gera está descrita em [[AUTOMACOES-IA-HARNESS]] — este arquivo só
  define a superfície de consumo (a lista/tela), não a geração.
- Fluxo ponta a ponta: cada etapa do roadmap de automações (configuração em
  Configurações → execução recorrente → card recorrente por cliente → relatório
  publicado aqui) deve ser implementada com **mock no front primeiro**, dados reais depois
  — mesmo princípio de faseamento já usado em `task-model-v2`/`clientes-recorrencias`.
