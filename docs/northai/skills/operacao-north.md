---
name: operacao-north
description: Como a North opera de ponta a ponta — jornada do cliente, fases, prazos de produção, papéis e o mapeamento de cada conceito para tipos, subtipos, payload e rotas do portal. Use antes de criar ou sugerir qualquer tarefa, plano, rotina, fluxo ou automação.
---

# Operação North

A North é uma assessoria de crescimento: estratégia, conteúdo e tráfego para
negócios locais. "Estratégia é a direção." Este documento é o que o NorthAi
precisa saber para agir como alguém da operação. Hoje o NorthAi é
determinístico (receitas); no roadmap (R4.11) um modelo lê este mesmo texto.

## Vocabulário

| Termo da operação | No portal |
|---|---|
| Cliente | `clients` (slug é a URL do portal: `/<slug>`) |
| Tarefa / demanda | card em `tasks`, tipo `operacional` ("Tarefa") |
| Entrega / fluxo em cascata | card com `payload.flow_parent = true`, tipo com `behavior = 'entrega'`; cada etapa concluída cria a próxima (`lib/flows/advance.ts`) |
| Etapa | card filho materializado da entrega; `relation_kind = 'workflow_step'`, com `slot` apenas como papel e ordem da etapa. Pode alimentar mais de uma Entrega quando o trabalho é realmente compartilhado. |
| Plano de ação | card `kind = 'plano_acao'`; atividades são membros estruturais (`relation_kind = 'structural_member'`). Cada card tem no máximo um pai estrutural. |
| Rotina / recorrência | card molde com `recurrence_cadence` (`semanal`, `quinzenal`, `mensal`); cada ciclo concluído registra `payload.cycle_log` (data e quem) |
| Diária de gravação | um roteiro e uma captação compartilhados por várias entregas (`lib/flows/shootDayRows.ts`) |
| Formato | `payload.formato` — Reels vertical, Carrossel, Stories, Banner, Post feed (`lib/northai/formats.ts`) |
| Situação | derivada, nunca gravada: Parada, Atrasada, Concluída, No prazo (`app/admin/deadlineState.ts`) |
| Automação | configuração + execuções/artefatos, ligada à família sem alterar o tipo do card; não é um quinto tipo estrutural |
| GED | armazenamento interno de arquivos do cliente (ver `ged.md`) |

Status do quadro: Entrada (`backlog`), Em produção, Revisão, Aprovação, Concluído
(`aprovado`), Parada. "Concluída" é `status = 'aprovado'`.

## A jornada (14 passos)

**Fase comercial:** 01 Lead → 02 Qualificação → 03 Venda → 04 Contrato.
**Fase de entrega:** 05 Kickoff → 06 Onboarding → 07 Planejamento → 08 Roteiros
→ 09 Gravação → 10 Edição → 11 Publicação → 12 Tráfego → 13 Reunião tática →
14 Novo ciclo (volta ao planejamento).

Detalhe do que existe e do que falta: `docs/northai/JORNADA-PONTA-A-PONTA.md`.

### Comercial

- O formulário é a primeira leitura estratégica: perfil do negócio, momento,
  necessidades, objetivos, estrutura atual, maturidade, capacidade de
  investimento, dificuldades, interesse nos serviços. **O lead sai classificado.**
- **Bronze** (low ticket): cursos, trilhas, produtos de entrada — formulário →
  classificação → landing page → vídeo de vendas → compra.
- **Prata** (atuação próxima): tráfego pago (gestão + 4 roteiros), consultoria
  comercial, Google Empresa — formulário → classificação → reunião → proposta → fechamento.
- **Ouro** (estruturação completa): tráfego, consultoria, CRM, IA para
  atendimento, otimização e campanhas Google — mesmo caminho do Prata.
- A proposta vale **5 dias úteis**; o follow-up acontece **no 4º dia útil**.
  Nenhuma reunião termina sem próximo passo.
- Assinatura + pagamento encerram o comercial e começam a entrega.

### Entrega

- **Implantação** (ao fechar): criar Drive/GED, página do cliente, ajustar
  briefing, grupo de WhatsApp com logomarca, agendar kickoff, mensagem de boas-vindas.
- **Kickoff em até 48h após o pagamento**: apresentar o portal, orientar as
  ações do cliente, liberar acessos, pedir históricos, materiais, senhas e
  acesso ao Business Meta, alinhar prazos, e já trazer a entrega contratada
  (quantidade de conteúdos e formatos, serviços do plano, metas por ciclo).
- **Plano de 60 dias**: documento "identidade do cliente + perspectiva e
  diagnóstico North", feito por planejamento, comercial, tráfego e conteúdo.
- **Planejamento interno** (antes do onboarding): entregas contratadas e
  quantidade, formatos para testar, ideias da biblioteca de anúncios, preparação
  de roteiros, calendário de publicação, campanhas previstas. **O portal não
  deixa a equipe trabalhar de memória: a entrega contratual fica vinculada ao planejamento.**
- **Onboarding** (uma vez só, o manual da relação): projeto (linha editorial,
  planejamento, entregas e formatos, fluxo de aprovação), produção (data de
  gravação, captação, roteiros, edição, publicação), portal e comunicação
  (onde acompanhar, onde o cliente age, canal oficial, responsáveis, horários),
  responsabilidades (o que é da North, o que é do cliente, combinados
  inegociáveis). Termina com **Start: data de gravação**.

### Produção

Gravação pela North:

| Momento | Etapa | Prazo |
|---|---|---|
| D-4 | Roteirização (padrão North) | vence 4 dias antes da gravação |
| D-0 | Gravação | até 3 dias |
| +4 d | Edição | até 4 dias |
| depois | Copy + capa → Publicação | publicações em dias alternados |

Gravação pelo cliente: a North sinaliza a necessidade de imagens, passa os
roteiros da base (o arsenal criativo), o cliente grava em **2 dias úteis**, a
North edita em **2 dias úteis** e libera para tráfego e social media.

**Padrão de roteiro North** (toda peça): Estratégia → Ideia → Gancho →
Desenvolvimento → Informação → CTA.

Status que a jornada usa por etapa: Roteirização, Edição, Copy + capa e
Publicação = Não iniciado / Concluído; Gravação = Agendada / Concluída. No
portal: a etapa nasce em Entrada e conclui em Concluído; captação com data =
gravação agendada.

**Decisão de 15/09:** a Entrega continua com 4 etapas (roteiro, captação,
edição, publicação); copy + capa fazem parte da publicação.

### Ritmo recorrente

- **Assessoria semanal**: reunião, plano de ação no WhatsApp ou ligação —
  atendimento dos leads, treinamento de vendas, orientações e script,
  relatório de tráfego, missões e atividades. No portal: rotina padrão
  "Acompanhamento semanal" + relatório de anúncios automático toda segunda às 9h.
- **Reunião tática mensal**: padrão de gestão mensal. **Toda reunião termina
  com a próxima data de gravação definida** — e um novo ciclo começa.

## Rotinas padrão do cadastro

O cadastro só finaliza com data e responsável de cada uma
(`lib/clientRoutines.ts`): Assinatura de contrato, Kickoff, Onboarding,
Acompanhamento semanal, Reunião mensal. As periódicas viram rotinas sempre abertas.

## Papéis (Equipe & papéis)

As etapas nascem com o responsável do papel quando há um cadastrado
(`responsibility_assignments`). Distribuição atual: Luiza — roteiro e gestão de
tráfego; Allan — gestão de tráfego e edição; Alisson — edição e captação;
Cintia — aprovação.

## Regras para o NorthAi

1. **Nada é criado sem prévia.** Mostre o que vai nascer, com datas e responsáveis.
2. **Uma porta só**: toda criação passa por `createTaskFromInput`
   (`lib/tasks/createFromInput.ts`) ou pelas funções de fluxo — nunca insert direto.
3. **Diária de gravação**: um roteiro e uma captação para várias peças; cada
   peça com seu formato (padrão Reels) e sua edição e publicação.
4. **Formato é escolhido por peça**, não fixo por cliente.
5. **Arquivo do Google enviado vira cópia no GED** antes de ser lido.
6. **Não deixe card de teste com período carimbado em cliente real.**
7. Quando faltar informação (data, cliente, tipo), pergunte ou deixe a receita
   incompleta — não invente.
8. Prefira resolver lacunas existentes ("O que falta amarrar") a criar trabalho novo.
