---
name: receitas-northai
description: O que cada receita do Estúdio NorthAi pede, o que cria (operações do Blueprint), os prazos padrão e os limites. Use para montar ou revisar um Blueprint.
---

# Receitas do Estúdio

Código: `lib/northai/recipes.ts` (puro, com testes). Contrato:
`lib/northai/blueprint.ts`. Execução: `POST /api/admin/northai/execute`, em
ordem, sem transação — em falha, a resposta traz o que já foi criado e o erro.

Operações do Blueprint:

| Operação | O que faz | Porta usada |
|---|---|---|
| `createTask` (scope `task`/`plan`/`routine`) | Cria tarefa, plano ou rotina; `planRef`/`planId` liga a um plano | `createTaskFromInput` |
| `createShootDay` | Diária de gravação: N entregas + 1 roteiro + 1 captação compartilhados | `createShootDay` (`lib/flows/shootDay.ts`) |
| `createAutomation` | Registra a automação num card (`targetRef` de uma operação anterior ou `targetTaskId`) | `createAutomationConfig` |

`ref` nomeia a operação para as seguintes (ex.: `plano`, `alvo`).

## Diária de gravação

**Pede:** cliente, data da gravação, publicações (título, formato, data de
publicação opcional), responsável, tipo Entrega com etapas roteiro e captação,
agrupar num plano (padrão sim). Entrada rápida: roteiros colados, link do Docs
(copiado para o GED e separado por `scriptParser`) ou "3 reels e 1 carrossel,
gravação 22/09".

**Cria:** plano "Diária de gravação DD/MM — Cliente" (opcional) →
`createShootDay` com:
- 1 roteiro "Roteiros da diária DD/MM" (vence D-4, nunca antes de hoje; descrição com o link do documento e a lista de peças);
- 1 captação "Gravação DD/MM — N publicações" (vence no dia);
- 1 entrega por peça, `payload.formato` da peça, prazo = data de publicação (padrão D+6, D+8, D+10…).

Os slots `roteiro` e `captacao` de todas as entregas apontam para os mesmos dois
cards. Concluir a captação cria a edição de cada peça.

**Separação dos roteiros** (`lib/northai/scriptParser.ts`): títulos com a
palavra do conteúdo ("ROTEIRO 1 — REELS", "Carrossel 2:"), depois separadores
(`---`), depois numeração curta que não seja seção do padrão North (gancho, CTA…).
Formato pelo título ou pelo início do texto; padrão Reels.

## Plano de ação

**Pede:** nome, início, responsável, volume por formato, outras atividades (uma por linha).
**Cria:** o plano + atividades com prazo a partir do início: Reels, anúncios e
carrosséis usam as etapas agrupadas de `app/admin/contentPlan.ts` (roteiro do
bloco, gravação, edição por formato, design, aprovação, publicação); banners,
stories e posts viram "Design — N …" (+7 dias); outras atividades +7 dias.

## Rotina

**Pede:** nome, repetição (uma vez, semanal, quinzenal, mensal), primeira data,
dias da semana (opcional), responsável, descrição.
**Cria:** rotina (`scope=routine`) ou, sem repetição, uma tarefa com data. As
rotinas padrão que faltam aparecem em "O que falta amarrar" e abrem esta receita
preenchida.

## Fluxo

**Pede:** título, tipo Entrega, formato, quantidade, prazo, responsável, plano (opcional).
**Cria:** N entregas completas (cada uma nasce na primeira etapa). Para peças da
mesma gravação, use a diária.

## Automação

**Pede:** a automação (catálogo) e o card-alvo — uma rotina existente do cliente
ou uma rotina nova (nome, repetição, início, responsável).
**Cria:** a rotina (se nova) + a automação ligada a ela. Automações com
dependência (relatório de vendas depende do de anúncios no mesmo card) são
recusadas pelo servidor se a dependência não existir.

## Analisar operação

Não cria nada. Lista as lacunas do cliente (`lib/northai/gaps.ts`): cards
parados e atrasados, rotinas padrão faltando, cards sem responsável ou sem data,
entregas sem formato, nenhuma automação ativa, nenhum plano aberto, GED sem
pastas. O "Cadastro conectado %" soma contrato, briefing, rotinas padrão,
responsáveis, automação ativa e GED.

## Comandos curtos (`lib/northai/commandParser.ts`)

Reconhece quantidades por formato ("3 reels", "2x carrossel"), datas dd/mm (sem
ano = a próxima ocorrência), "hoje"/"amanhã", nome ou slug do cliente, cadência
e dia da semana, links. Intenção por palavra-chave: gravação/roteiros → diária;
automação/relatório → automação; rotina/semanal/mensal → rotina; plano → plano;
fluxo/entrega → fluxo; atrasadas/paradas/falta → análise. Só quantidades: com
data vira diária, sem data vira plano. O comando só pré-preenche a receita.
