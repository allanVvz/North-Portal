# Fluxo real da operação North — mapeado para a plataforma

> Fonte: transcrição de anotações/quadro da operação (fotos), enviada pelo usuário em 2026-07-07. O usuário já havia organizado o material bruto em 8 fluxos (seção 4 da transcrição) — este documento pega esses 8 fluxos e aponta **onde cada etapa vive hoje na plataforma** (Admin + Portal do Cliente), o que já está coberto e o que ainda é lacuna (gap).
>
> Não é um plano de execução — é um mapa de referência para orientar as próximas telas/decisões. A transcrição bruta original está preservada no [Apêndice](#apêndice--transcrição-bruta).

## Como ler este documento

Para cada fluxo: **Objetivo** (por que existe) → **Etapas** (o que a transcrição descreve) → **Onde vive hoje** (tela/arquivo real da plataforma) → **Gap** (o que a etapa pede e a plataforma ainda não faz).

Vocabulário da plataforma usado nas referências:
- **Admin**: `/admin` (Clientes), `/admin/kanban` (Tarefas), `/admin/revisoes`, `/admin/aprovacoes`, `/admin/onboarding`, `/admin/documentos`, `/admin/performance`, `/admin/plano`, `/admin/configuracoes`.
- **Portal do cliente** (`app/[slug]`, 4 territórios da bússola — ver [[portal-nav-bussola]]): **Cliente** (Jornada, Briefing, Acessos & Pastas), **Operação** (Agenda, Feedbacks, Plano de Ação), **North** (Time North, Trilhas North, Documentos, Central Comercial), **Resultados** (Dashboard).
- **Kanban / `tasks`**: 6 colunas reais — Entrada → Em produção → Revisão → Aprovação → Concluído → Publicado (`app/admin/kanbanShared.ts`).

---

## Fluxo 1 — Entrada do cliente na operação

**Objetivo:** transformar cliente assinado em cliente ativo dentro da North.

**Etapas:** cliente assina/fecha contrato → North cria grupo no WhatsApp → agenda onboarding em até 2 dias → envia briefing inicial → organiza pasta do cliente → centraliza documentos/materiais/acessos/arquivos MD → cliente entra no painel como "Em Onboarding".

**Onde vive hoje:**
- Cadastro do cliente: `/admin/novo` (`app/admin/novo/page.tsx`) cria o registro em `clients` e já convida a conta de acesso.
- Briefing inicial: existe como wizard completo do lado do cliente (Portal → Jornada, etapa "Café" + 12 etapas/18 cards, `briefing_answers`), mas **quem dispara o convite pra preencher é manual** (não há um "enviar briefing" com notificação).
- Pasta/acessos: `client_drive_links` (Portal → Acessos & Pastas) — campos fixos (upload, contrato etc.), preenchidos no editor do cliente (`ClientEditor.tsx`).

**Gap:**
- **Não existe o conceito de estágio do cliente** (`Em negociação / Em onboarding / Em planejamento / Ativo`). Hoje `clients` só tem `is_active` boolean — é um interruptor liga/desliga, não um funil. Isso é o maior buraco estrutural para o "Painel operação" descrito na transcrição (seção 1).
- Sem integração com WhatsApp (criação de grupo é 100% manual, fora da plataforma — esperado, não é escopo de produto).
- Sem lembrete/SLA de "agendar onboarding em até 2 dias" — nenhuma tarefa é auto-criada na entrada de um cliente novo.

---

## Fluxo 2 — Onboarding e coleta de informações

**Objetivo:** coletar tudo que o time precisa para começar a operação.

**Etapas:** montar reunião de onboarding → pedir acessos → validar novo WhatsApp → compartilhar link da pasta → explicar cronograma mensal → registrar materiais/pontos importantes → agendar gravações → entregar presente North → mover cliente para "Em Planejamento".

**Onde vive hoje:**
- `/admin/onboarding` (`app/admin/onboarding/page.tsx` + `BriefingModal.tsx`) já mostra o progresso do briefing por cliente e exporta CSV das respostas — cobre a parte de "coletar/registrar informações".
- Compartilhar link da pasta: Portal → Acessos & Pastas (`client_drive_links.uploadsUrl` e afins).
- Agendamentos: Kanban `kind=agendamento` (Portal → Agenda) cobre "agendar gravações" uma vez que a tarefa exista.

**Gap:**
- "Presente North", "validar novo WhatsApp" e "explicar cronograma mensal" são itens de **checklist de reunião**, sem representação na plataforma (nem como task template, nem como campo). Não há um checklist de onboarding estruturado — só o briefing (perguntas do cliente) e as tasks manuais que o admin cria uma a uma.
- "Mover cliente para Em Planejamento" depende do estágio do cliente do Fluxo 1 (mesmo gap).

---

## Fluxo 3 — Planejamento operacional

**Objetivo:** transformar o briefing em plano de ação.

**Etapas:** analisar briefing → identificar serviço contratado → definir responsáveis internos → criar demandas no Kanban → separar por status (A Fazer/Fazendo/Feito) → definir prazo/responsável/status de cada demanda → planejar conteúdos, criativos, campanha de tráfego e assessoria comercial.

**Onde vive hoje — bem coberto:**
- Criar demandas: `/admin/kanban` (`KanbanBoard.tsx` + `TaskModal.tsx`), com `kind` no catálogo (`lib/taskCatalog.ts`: plano_acao, criativo, agendamento, planejamento, operacional, checkpoint_comercial). Roteiro é subtipo de planejamento; gravação é subtipo de agendamento; recorrência é atributo de qualquer tipo elegível.
- Prazo/responsável/status: campos nativos do card (`assignee`, `due_date`, `status`, `priority`).
- "Serviço contratado": hoje é só texto livre no editor do cliente (não linka com o catálogo de tarefas do Kanban).
- Plano de Ação como card real (`kind=plano_acao`, `plan_id`) agrega as demandas-membro com progresso rollado — ver [[task-model-v2]].

**Gap:**
- O funil "A Fazer/Fazendo/Feito" da transcrição é uma simplificação de 3 estágios; o Kanban real tem 6 (Entrada/Em produção/Revisão/Aprovação/Concluído/Publicado) — mais granular, não é um problema, mas vale alinhar a linguagem em treinamento do time.
- "Identificar serviço contratado" não é estruturado (sem catálogo de serviços vinculado ao cliente).

---

## Fluxo 4 — Produção e aprovação

**Objetivo:** produzir os materiais antes do start da operação.

**Etapas:** produzir conteúdos/criativos → organizar na pasta do cliente → enviar para aprovação → ajustar se necessário → aprovar peças finais → liberar scripts comerciais → liberar manual/story → preparar apresentação do painel.

**Onde vive hoje — bem coberto pelo trio Revisão/Aprovação:**
- Produção: cards `em_producao` no Kanban.
- Enviar para aprovação / ajustar: `/admin/revisoes` (interno, admin↔admin) e `/admin/aprovacoes` + Portal → Feedbacks (cliente aprova ou pede ajuste, com comentário anexado ao card — não muda mais o status ao pedir ajuste, fica na mesma coluna).
- "Liberar manual/story": Portal → **Trilhas North** (central educacional, hero "Manual do Cliente") — mapeamento direto.

**Gap:**
- "Liberar scripts comerciais" hoje não tem lar óbvio: Portal → Central Comercial existe, mas hoje é sobre **contrato/plano/cobrança**, não scripts de vendas — nomeação colide com o "Ass. Comercial" da transcrição, que é assessoria comercial pro time de vendas do cliente. Vale decidir se scripts vão para Trilhas North (conteúdo educacional) ou se Central Comercial ganha uma seção nova.
- "Preparar apresentação do painel" não tem artefato — é preparo humano antes da reunião do Fluxo 8.

---

## Fluxo 5 — Start da operação

**Objetivo:** colocar campanha, conteúdo e atendimento comercial em funcionamento.

**Etapas:** configurar campanha de TP → start campanha → start conteúdo → ativar WhatsApp → acionar WPP dos leads → iniciar acompanhamento de chegada dos leads → integrar CS + gestão de tráfego + assessoria comercial → registrar dados no painel.

**Onde vive hoje:**
- Configurar/start campanha e conteúdo: cards `kind=agendamento`/`criativo` mudando de status no Kanban (Publicado = foi ao ar).
- "Registrar dados no painel": Portal → Dashboard (Resultados) lê `client_results` (`topMetrics/insights/reportUrl`) e Kanban `/admin/performance` grava métricas por tarefa publicada (`task_metrics`, catálogo `app/admin/metricDefs.ts`, priorizado em Meta Ads).

**Gap:**
- Não há representação de leads/CRM na plataforma — "acionar WPP dos leads" e "acompanhamento de chegada dos leads" são operação externa (WhatsApp/CRM comercial), fora do escopo atual de dados. Se isso precisar de painel, seria uma métrica manual em `task_metrics` ou um novo `kind` no catálogo.
- Nenhuma flag distingue "campanha configurada" de "campanha no ar" além do status do card — suficiente por ora, mas sem campo de "data de start" dedicado (existe `start_date`/`scheduled_start_at` no schema de tasks, já reaproveitável).

---

## Fluxo 6 — Acompanhamento semanal

**Objetivo:** manter operação viva, corrigir rota e garantir performance.

**Etapas:** ligação semanal de CS → analisar chegada dos leads → verificar scripts → acompanhar publicação → otimizações semanais → atualizar status das demandas → atualizar painel de performance → registrar atrasos/pendências/próximos passos.

**Onde vive hoje:**
- Atualizar status das demandas: Kanban (drag-and-drop, tempo real via `lib/useTaskRealtime.ts`).
- Atualizar painel de performance: `/admin/performance`.
- Atrasos: os cards têm `due_date`, mas **não há indicador visual de "atrasado" nem alerta** — a transcrição pede explicitamente "Status: no prazo / atrasado" no card de demanda (seção 1), que hoje não existe como badge.

**Gap:**
- **Badge "no prazo / atrasado"** nos cards do Kanban — comparar `due_date` com hoje é trivial de calcular, é só UI faltando. Candidato natural pra próxima leva de melhorias.
- Ligação semanal de CS não tem registro estruturado (viraria um `kind=operacional` recorrente ou um log — hoje seria só uma task manual criada toda semana).
- Nenhum lugar consolida "próximos passos" fora dos comentários de cada card individual.

---

## Fluxo 7 — Visão gerencial do cliente

**Objetivo:** dar controle para gestão North enxergar saúde da carteira.

**Etapas/campos pedidos por cliente:** nome, responsável interno, serviço contratado, data de pagamento, status financeiro (a vencer/vencido/pago), próximo contato, início do contrato, data de renovação, painel de performance atualizado, demandas pendentes/atrasadas, relatório resumido, histórico de atualizações.

**Onde vive hoje — parcialmente coberto:**
- `/admin` (Clientes, `ClientsTable.tsx`) lista carteira com `is_active`.
- Responsável, performance, relatório: já existem em `client_results`/`ClientEditor.tsx` (métricas, insights, `reportUrl`).
- Demandas pendentes/atrasadas: dá pra derivar do Kanban filtrando por cliente, mas **não existe um resumo por cliente na lista** — hoje é preciso entrar no Kanban e trocar de cliente.

**Gap — este é o núcleo do "Painel operação" da transcrição (seção 1) e ainda não existe:**
- Campos ausentes em `clients`: **próximo contato, data de pagamento + status financeiro (a vencer/vencido/pago), início do contrato, data de renovação**. Nenhum desses tem coluna hoje.
- Sem **quadro Kanban de clientes** por estágio (`Em negociação | Em onboarding | Em planejamento | Ativo/TP+Mídias+Google+Assessoria`) — só existe o Kanban de **tarefas**. Seriam duas entidades Kanban distintas: cliente (funil comercial/onboarding) e tarefa (produção). Vale decidir se isso é uma tabela nova (`client_stage`) ou um campo em `clients`.
- "Histórico de atualizações" por cliente não existe como feed — só o histórico de tasks/comentários, disperso.

---

## Fluxo 8 — Fechamento mensal

**Objetivo:** consolidar resultado e planejar o próximo ciclo.

**Etapas:** agendar reunião mensal → gerar relatório padrão North → leitura resumida dos dados → apresentar análise/otimizações → revisar campanha/conteúdo/comercial → apresentar painel ao cliente → registrar novas demandas → atualizar financeiro → definir próximos passos → realizar reunião tática mensal.

**Onde vive hoje:**
- Relatório: `client_results.reportUrl` (link para doc externo, editável em `ClientEditor.tsx`) alimenta Portal → Dashboard ("Gerar doc relatório padrão North" da transcrição = esse link, hoje colado manualmente, não gerado).
- Registrar novas demandas: Kanban, normal.
- Agendar reunião mensal: `kind=agendamento` no Kanban → aparece na Agenda do portal.

**Gap:**
- Nenhuma automação de "relatório padrão North" — é um doc externo linkado, não gerado pela plataforma.
- "Atualizar financeiro" depende do mesmo gap de status financeiro do Fluxo 7 (não existe hoje).
- Sem conceito de "ciclo mensal" que agrupe o fechamento de um mês (relatório + demandas + financeiro) num único registro — cada peça vive solta.

---

## Mapa consolidado — o que já existe vs. o que falta

| Área da transcrição | Cobertura hoje | Gap principal |
|---|---|---|
| Kanban de tarefas (produção) | ✅ Completo — 6 colunas, tipos, revisão, aprovação, tempo real | Badge "atrasado" |
| Briefing / onboarding do cliente | ✅ Completo — wizard + `/admin/onboarding` | Checklist de reunião (WhatsApp/presente/cronograma) não estruturado |
| Aprovação de entregas (cliente) | ✅ Completo — Portal Feedbacks + `/admin/aprovacoes` | — |
| Plano de Ação | ✅ Completo — card real, progresso rollado | — |
| Performance / métricas | ✅ Completo — `/admin/performance`, Dashboard do cliente | — |
| Documentos | ✅ Completo — tabela `documents`, Storage/URL | — |
| **Funil comercial do cliente** (negociação→onboarding→planejamento→ativo) | ❌ Não existe | Maior gap — precisa de campo/tabela de estágio |
| **Dados financeiros do cliente** (pagamento, vencimento, renovação) | ❌ Não existe | Colunas novas em `clients` |
| **Visão gerencial consolidada** (1 card por cliente com tudo do Fluxo 7) | ❌ Não existe como tela | Depende dos 2 gaps acima |
| Scripts/assessoria comercial pro cliente | ⚠️ Ambíguo | "Central Comercial" hoje = contrato/cobrança, não scripts — decidir onde mora |
| CRM de leads (chegada, WPP) | ❌ Fora do escopo atual | Não seria dado nativo, provável integração externa |

---

## Apêndice — transcrição bruta

<details>
<summary>Clique para expandir a transcrição original enviada em 2026-07-07 (fotos do quadro/anotações da operação)</summary>

### 1. Transcrição — Portal North

Portal — North · Enviar revisão · Arquivo MD dos clientes · Documentos centralizados North · Painel operação funcionamento

**Operação** — colunas: Em negociação | Em onboarding | Em planejamento | TP + Gest. Mídias + Google + Ass. Comercial

**Card do cliente — Em negociação**: Nome cliente, Próx. contato, Contratado, Nome responsável, Data pagamento, Serviço contratado, Início, Renovação, Demandas.

**Demandas** — colunas: A fazer | Fazendo | Feito

**Card de demanda**: Demanda descrita, Cliente, Responsável, Prazo, Status (no prazo / atrasado).

**Dados do cliente**: Nome cliente, Responsável, Serviço contratado, Data pg (status — a vencer), Painel performance (atualizado X dia).

**Visão gerencial — Clientes**: Lançar atualização, Resumo relatório, Gerar doc relatório padrão North, Leitura resumida dados, Lançar pg financeiro, Demanda da equipe referente ao [trecho final ilegível].

### 2. Transcrição — Ações mês 01 — Cliente

Criar grupo WPP → Agendar onboarding → Enviar briefing → Montar reunião onboarding → Realizar reunião.

Dentro da reunião: pedir acessos/novo WPP, compartilhar link da pasta, apresentar cronograma mensal [provável], agendar gravação se houver, entregar/enviar presente North.

Produzir conteúdos/criativos → Aprovar materiais → Configurar campanha TP → Start campanha/conteúdo → Acesso WPP → Análise chegada dos leads (CS + GT [provável]) → Reunião de assessoria comercial (scripts) → Acompanhamento + publicar + otimizações (semanal) → Agendar reunião mensal → Realizar reunião mensal.

### 3. Transcrição — Jornada Cliente Novo

**Jornada Cliente Novo — Parte 1**, período de 4 semanas de ação.

Linha do tempo: Onboarding → Planejamento e identificação → Start TP → Start conteúdo → Consultoria e análise comercial → Implementação e acompanhamento → Análise de dados e otimização → Reunião tática mensal → Checklist com time + cliente.

Após assinatura: criar grupo WPP → agendar reunião onboarding (máx. 2 dias) → enviar briefing → montar reunião onboarding + acessos → pastas e materiais do cliente → gravação/produção criativos e conteúdo → start TP → ligação semanal CS → ações comerciais/operação → acionar WPP dos leads → liberar scripts → liberar manual/story → apresentar painel.

</details>
