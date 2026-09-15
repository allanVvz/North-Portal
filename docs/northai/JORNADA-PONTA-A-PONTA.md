# Jornada do cliente ponta a ponta — o que o portal cobre e o que falta

Fonte: a apresentação interna "A jornada do cliente" (17 slides, reunião de
portal & processos) comparada com o código em `main` em 15/09/2026. Serve de
mapa para o NorthAi e para priorizar o roadmap (R4.13).

O mapa anterior, `docs/FLUXO-OPERACAO-NORTH.md`, é de julho e ficou para trás:
leads, pipeline de clientes, rotinas padrão no cadastro, fluxos em cascata e o
relatório semanal automático já existem.

## O que a jornada pede que o portal mostre (slide 2)

Para cada cliente, em tempo real: **onde está**, **o que já aconteceu**, **o
que precisa acontecer**, **quem é o responsável**, **qual o prazo**, **o que
depende do cliente** e **qual é o próximo passo**.

| Pergunta | Hoje no portal | Falta |
|---|---|---|
| Onde está | Pipeline de clientes com 3 estágios (Criação, Onboarding, Em Operação — `app/admin/clientPipeline.ts`) | Os 14 passos da jornada. O estágio vem só de briefing e checkpoints |
| O que já aconteceu | Cards concluídos, checks de recorrência com data e quem concluiu, comentários | Linha do tempo única por cliente |
| O que precisa acontecer | Quadro, rotinas, planos, entregas; "O que falta amarrar" no Estúdio | — |
| Responsável e prazo | Em todo card; atrasadas/paradas na Home | — |
| O que depende do cliente | Aprovações (portal Feedbacks + `/admin/aprovacoes`) | Pedidos de acesso, senhas e materiais do kickoff como pendências do cliente |
| Próximo passo | Etapa atual das entregas | Próximo passo da JORNADA (ex.: "agendar gravação") |

## Passo a passo

Legenda: ✅ coberto · ⚠️ parcial · ❌ não existe.

### Fase comercial

| # | Passo da jornada | Admin hoje | Cliente hoje | Falta |
|---|---|---|---|---|
| 01 | **Lead** — formulário como primeira leitura estratégica; o lead sai classificado | ⚠️ Tela Leads (`app/admin/clientes/LeadsScreen.tsx`) com identidade, UTM, status e notas; conversão em cliente no cadastro | — | Campos de leitura estratégica: perfil, momento, necessidades, objetivos, estrutura, maturidade, capacidade de investimento, dificuldades, interesse |
| 02 | **Classificação** Bronze (low ticket) / Prata (atuação próxima) / Ouro (estruturação completa) | ⚠️ `plano_tier` existe no contrato do CLIENTE | — | Classificação no LEAD; rota Bronze (LP → vídeo de vendas → compra) fora do portal |
| 03 | **Apresentação, proposta, follow-up e fechamento** — proposta vale 5 dias úteis, follow no 4º dia | ⚠️ Documento tipo `proposta`; status do lead | — | Status Fechado / Proposta enviada / Aguardando decisão / Sem fit; follow-up automático no 4º dia útil (automação ou rotina do NorthAi); "nenhuma reunião termina sem próximo passo" |
| 04 | **Contrato** — assinatura e pagamento encerram o comercial | ⚠️ Documento `contrato` com status de assinatura; rotina padrão "Assinatura de contrato" | ⚠️ Documentos no portal | Pagamento/financeiro do cliente; assinar + pagar mover o cliente para implantação sozinho |

### Fase de entrega North

| # | Passo | Admin hoje | Cliente hoje | Falta |
|---|---|---|---|---|
| 05 | **Implantação** — Drive, página do cliente, briefing, grupo de WhatsApp, agendar kickoff, boas-vindas | ⚠️ Cadastro cria login, briefing, GED (15/09), rotinas padrão com data e responsável | ⚠️ Portal existe, mas nenhum cliente real tem login | Tarefas de implantação (grupo de WhatsApp com logomarca, mensagem de boas-vindas) como checklist padrão |
| 06 | **Kickoff** — até 48h após o pagamento; portal, acessos, Business Meta, prazos, entrega contratada | ⚠️ Rotina padrão "Kickoff" com data e responsável | — | SLA de 48h a partir do pagamento; checklist do encontro; pedidos de acesso como pendências do cliente |
| 07 | **Construção do plano** — plano de 60 dias, "identidade do cliente + diagnóstico North" | ⚠️ Plano de Ação como card; escopo contratado com quantidades (tags de escopo) | ⚠️ Plano visível no portal (toggle) | Documento de identidade + diagnóstico como entregável do portal; prazo de 60 dias |
| 08 | **Planejamento interno do conteúdo** — entregas contratadas, formatos, biblioteca de anúncios, roteiros, calendário, campanhas | ⚠️ Plano de conteúdo por volume (combobox do plano); NorthAi gera plano e diária | — | Comparar o planejado com o contratado (alerta quando o plano tem menos peças que o escopo); calendário de publicação; campanhas previstas |
| 09 | **Onboarding** — o manual da relação, uma vez só | ⚠️ Briefing; checkpoints; Manual do Cliente (deck) nas Trilhas | ⚠️ Manual e trilhas no portal | As seções do onboarding (linha editorial, fluxo de aprovação, data de gravação, canais, responsabilidades) como checklist; **"Start: data de gravação"** registrado |
| 10 | **Roteirização** (D-4) — padrão Estratégia → Ideia → Gancho → Desenvolvimento → Informação → CTA | ✅ Etapa roteiro das entregas; **diária de gravação com roteiro compartilhado** e importação do Docs para o GED (NorthAi, 15/09) | — | Modelo do padrão North dentro do card de roteiro; aprovação do roteiro pelo cliente quando o plano pedir |
| 11 | **Gravação** (D-0) — pela North (até 3 dias) ou pelo cliente (2 dias úteis) | ⚠️ Etapa captação, compartilhada pela diária | — | Status "Agendada/Concluída" da gravação (hoje os status do quadro); cenário "gravação pelo cliente" |
| 12 | **Edição** (+4 dias) → **Copy + capa** → **Publicação** | ✅ Etapas edição e publicação por peça; formato por peça (Reels, carrossel, banner, story) | ✅ Aprovação das peças | "Copy + capa" fica dentro da publicação (decisão de 15/09); liberar a edição para tráfego/social media como aviso |
| 13 | **Tráfego** | ✅ Performance; relatório de anúncios toda segunda às 9h; relatório de vendas pelo feedback | ✅ Performance e relatórios no portal | Campanhas previstas no planejamento; ideias da biblioteca de anúncios |
| 14 | **Assessoria semanal** — reunião, plano no WhatsApp ou ligação; leads, vendas, scripts, relatório, missões | ✅ Rotina padrão "Acompanhamento semanal" com checks de ciclo | — | Pauta padrão da assessoria; "missões e atividades" para o cliente |
| 15 | **Reunião tática mensal** — termina com a próxima data de gravação | ⚠️ Rotina padrão "Reunião mensal" | — | Ao concluir o ciclo da reunião, pedir a próxima data de gravação e abrir a diária no NorthAi |
| 16 | **Novo ciclo** | ⚠️ Recorrências | — | "Ciclo mensal" que agrupe relatório, demandas e financeiro num registro |

### Calendário do ciclo (slide 16)

Gravação pela North: assessoria no dia 1, roteirização de 5 a 8, gravação no 9,
edição de 10 a 13, copy + capa no 14, publicações a partir do 15 em dias
alternados, assessoria semanal. A receita da diária usa este ritmo como padrão:
roteiro vence D-4, captação no dia, publicações a partir de D+6 a cada 2 dias.

## Prioridade sugerida

1. **Próxima data de gravação ao concluir a reunião tática** → abre a diária no NorthAi. Fecha o ciclo sem depender de memória.
2. **Plano × escopo contratado** — alerta quando o planejado é menor que o contratado. As quantidades já existem nas tags de escopo.
3. **Status "Agendada" na captação** e o cenário "gravação pelo cliente".
4. **Jornada de 14 passos por cliente** — substitui os 3 estágios do pipeline e responde "onde está / próximo passo".
5. **Comercial**: classificação Bronze/Prata/Ouro e status da proposta no lead, com follow-up no 4º dia útil.
6. **Financeiro e ciclo mensal** — dependem de dados que o portal ainda não guarda.
