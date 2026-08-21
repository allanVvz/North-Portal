# Automações — registro manual por card, genérico

Status: **v2 implementado** (schema + backend + UI, 2026-08-21) — ainda não commitado/
enviado ao GitHub, então ainda não em produção via Vercel; as migrations de banco (v2)
já foram aplicadas diretamente no projeto Supabase de produção via MCP. Supersede o
desenho v1 abaixo (mantido como histórico no final do arquivo) — v1 foi parcialmente
implementado (schema + código + UI) em 2026-08-20/21, depois **redesenhado do zero** a
pedido do usuário no dia seguinte, antes de qualquer deploy de código (a tabela
`automation_configs` v1 ficou com 0 linhas em produção o tempo todo, então a migração
de schema para v2 foi feita como `ALTER TABLE`, sem dado a migrar).

Relacionado: [[AUTOMACOES-IA-HARNESS]], [[task-model-v2]], [[PERFORMANCE-TEMPLATES-HIERARQUIA]].

## O que mudou do v1 pro v2 (resumo)

- **UI**: em vez de 2 cards fixos e hardcoded na tela (um por automação), agora é uma
  **lista de automações registradas manualmente**, cada uma um card genérico, mais uma
  **box pontilhada "+ Nova automação"** no final que, ao clicar, adiciona um novo card
  em branco à lista.
- **Card genérico** (mesmo componente para as duas automações): 2 seletores padrão —
  **Modelo de automação** (qual das automações) e **Card** (a busca/criação de card já
  existente, `AutomationCardPicker`). O **toggle "Automação ativa" fica no topo do
  card**. Quando o modelo escolhido é "Relatório de anúncios", aparece um 3º seletor,
  **Modelo de Performance**. Não existe mais seletor de "dias da semana" — cadência não
  é mais configurada na tela de automação, vem inteiramente do card escolhido.
- **Automação 1 (Relatório de anúncios) não cria mais seu próprio card por cliente.**
  O admin escolhe/cria o card manualmente (com a cadência que quiser, do jeito normal
  via TaskModal) e a automação passa a **reagir** a esse card conforme o formato dele —
  3 comportamentos distintos, ver seção própria abaixo.
- **Cron passa de semanal fixo pra diário.** Como a cadência agora é por card (pode
  cair em qualquer dia da semana, ou ser quinzenal/mensal), o cron precisa checar todo
  dia quais cards vencem hoje. Validado: Supabase não tem limite rígido de nº de cron
  jobs no free tier (só recomendação de ≤8 jobs concorrentes, cada um <10min) — 1 job
  diário é trivial nesse orçamento, e como bônus mantém o projeto free-tier "quente"
  (evita a pausa por inatividade de 1 semana sem uso).
- **Novo status de tarefa `parada`**, válido pra qualquer kind. Todo erro de automação
  (falha ao buscar dado, gerar PDF, subir arquivo, etc.) deixa um comentário no card
  explicando o erro e move esse card para `parada`, em vez de falhar silenciosamente ou
  derrubar o resto do cron run.

## UI da tela Automações (v2)

Mesma aba "Automações" em `SettingsPanel.tsx` (`AutomationSettings.tsx`), mas o
conteúdo agora é:

1. **Lista de automações já registradas** — uma chamada `GET /api/admin/automations`
   retorna todas as linhas de `automation_configs`, cada uma renderizada como um
   `.set-card` com:
   - Toggle **"Automação ativa"** no topo (antes de qualquer outro campo).
   - Seletor **"Modelo de automação"** — dropdown com as 2 chaves de
     `lib/automationCatalog.ts` (`relatorio_trafego_semanal` | `provisionar_card_metricas`).
   - Seletor **"Card"** — `AutomationCardPicker` (busca composta) + botão "+ Criar card"
     (abre `TaskModal` `mode="new"`), exatamente como já existia — mostra qual card está
     vinculado a essa automação.
   - **Se o modelo for "Relatório de anúncios"**: aparece o 3º seletor, **"Modelo de
     Performance"** (dropdown com os templates de `GET /api/admin/performance/templates`).
   - **Se o modelo for "Provisionar card por cliente"**: sem 3º seletor; mostra o botão
     **"Provisionar agora"** (dispara o fan-out síncrono, igual v1).
   - Botão "Remover" pra apagar o registro (`DELETE /api/admin/automations/[id]`).
2. **Box pontilhada "+ Nova automação"**, sempre por último na lista — ao clicar, insere
   um card em branco (ainda não salvo, sem `id`) no fim da lista com os campos vazios,
   pronto pra ser preenchido e salvo (`POST /api/admin/automations`). Cancelar antes de
   salvar apenas remove o card da lista local, sem tocar no banco.

## Automação 1 — Relatório de anúncios (3 comportamentos por formato do card)

Todo dia, o cron (`app/api/admin/automations/run`) resolve, pra cada
`automation_configs` ativa com `automation_key = 'relatorio_trafego_semanal'`, o card
alvo (`target_task_id`) e ramifica pelo **formato desse card**, exatamente o mesmo
espírito de ramificação por formato que a Automação 2 já usa:

1. **Task comum** (sem `recurrence_cadence`, `kind != 'plano_acao'`): quando
   `due_date` do próprio card cai em hoje, a automação executa **no próprio card** — gera
   o PDF, anexa como `documents` (`task_id` = o card), e move o card pra `revisao`. Não
   cria nada novo.
2. **Card recorrente** (`recurrence_cadence` setado, `kind != 'plano_acao'`): quando o
   `due_date` do card (que já avança normalmente a cada ciclo, ver `lib/recurrence.ts`)
   cai em hoje, a automação **materializa uma nova execução** — mesma mecânica de
   `recurringExecutionFields()`/`recurringExecutionId()` que o clique humano em
   "concluir ciclo" já usa (`completeTaskCycleForRequest`, `lib/supabase.ts:1294`), só
   que disparada pelo cron encontrando a data, não por um clique. O card **pai**
   permanece o template recorrente; a **nova execução** (o filho materializado) é quem
   recebe o PDF anexado e vai pra `revisao`. Idempotente pelo mesmo id determinístico
   (`recurringExecutionId(parentId, cycle)` colide em PK num retry).
3. **Plano de ação** (`kind = 'plano_acao'`): quando o `due_date` do plano-modelo cai em
   hoje, a automação **clona a estrutura inteira** (pai + membros, mesmo mecanismo de
   `lib/automations/provision.ts`'s `clonePlan`, mesmo cliente) numa nova instância do
   plano, anexa o PDF no **pai do clone**, e move o pai do clone pra `revisao`. O
   plano-modelo original nunca muda de status — só serve de gabarito, igual a Automação 2.

**Elegibilidade** continua sendo "o cliente do card tem conta de anúncios mapeada"
(Windsor ou Meta) — se não tiver, a execução daquele dia falha e vira `parada` com
comentário explicando (ver seção de erro abaixo), não é silenciosamente pulada.

**Janela do relatório**: calculada a partir da cadência do próprio card
(`recurrence_cadence`: semanal=7d, quinzenal=14d, mensal=30d; task comum sem
recorrência = janela de 7 dias terminando no `due_date`), terminando no `due_date` que
disparou a execução.

**Idempotência diária**: `automation_configs.last_run_date` — se já rodou hoje pra essa
config, o cron pula (evita reprocessar em caso de retry do mesmo tick).

## Automação 2 — Provisionar card por cliente (mantida como 2º exemplo do padrão genérico)

Sem mudança de mecânica (ainda o fan-out síncrono descrito no v1, seção própria mais
abaixo) — só passa a viver dentro do mesmo card genérico da tela nova, provando que o
padrão de 2 seletores generaliza: "Modelo de automação" = Provisionar card por cliente,
"Card" = o card-modelo a clonar. Não tem seletor de Performance (só a automação 1 usa).
Continua **não** sendo disparada por data/cron — é ação síncrona no botão "Provisionar
agora", porque a natureza dela é um fan-out imediato pra N clientes, não uma entrega
periódica por cliente único.

## Novo status `parada` — tratamento de erro uniforme

`parada` é adicionado ao enum `public.task_status` (mesmo padrão de
`20260706000002_task_aprovado_status.sql`: `alter type ... add value if not exists`),
**válido pra qualquer `kind`** — não é um passo do funil normal, é um estado lateral
"isso precisa de atenção humana", alcançável a partir de qualquer status.

- **Toda vez que uma execução de automação lança exceção** (falha ao buscar dado do
  Windsor/Meta, falha ao renderizar PDF, falha de upload, cliente sem conta mapeada,
  etc.), o sistema:
  1. Deixa um comentário no card mais relevante (`payload.comments`, mesmo formato
     `TaskComment` já usado em toda a base) explicando o erro em linguagem simples.
  2. Move esse card pro status `parada`.
  3. **Não derruba o resto do cron run** — cada `automation_configs` processada
     isoladamente em try/catch; uma falhando não impede as outras.
- **Qual card recebe o comentário+parada** depende de onde a falha aconteceu: se antes
  de qualquer card novo existir (ex. falha ao buscar dado), o comentário vai no
  `target_task_id` (o card/modelo registrado); se a falha for depois de já ter
  materializado/clonado um card novo (ex. falha ao subir o PDF), vai nesse card novo.
- **Progresso (%) trava no valor de antes de parar**: como `parada` fica fora dos mapas
  de `WORKFLOWS` (`lib/taskCatalog.ts`), o status anterior é gravado em
  `payload.pre_parada_status` no momento da transição, e `taskProgress()` usa esse
  valor congelado enquanto o card estiver em `parada` — evita que a barra de progresso
  pule pra 100% (cairia nesse valor por ser o "mais próximo pra trás" no array de
  status) ou zere injustamente.
- **Coluna no Kanban**: nova coluna "Parada" em `kanbanShared.ts` (`COLUMNS`), visível
  sempre que existir ao menos 1 card nela (mesmo critério de fallback que
  Revisão/Aprovação já usam) — sem toggle de "Ativo para Admin" por cliente, porque não
  é um estágio opcional de fluxo configurável, é um indicador de erro.
- **Nunca visível ao cliente** — cards em `parada` não aparecem no portal do cliente
  (mesma lógica de `client_visible`/rotas client-side já existente, sem necessidade de
  gate novo).

## Cron — diário, um job só

Migração substitui o agendamento semanal do v1 (`automations-run-weekly`,
`'0 8 * * 1'`) por um único job diário (`automations-run-daily`, `'0 8 * * *'`), mesma
rota (`app/api/admin/automations/run`), mesma checagem de `x-cron-secret`. A rota
processa toda `automation_configs` ativa cujo card alvo vence hoje; o resto (config sem
card vencendo hoje) é ignorado nesse tick, sem custo — não precisa de N jobs, um só
cobre qualquer cadência de qualquer card.

## Schema v2 de `automation_configs` (substitui o v1)

O v1 tinha `scope`/`client_id`/`recurrence_cadence`/`recurrence_weekdays`/
`recurrence_day_of_month`/`target_kind`/`target_subtype`/`parent_task_id` — todos
removidos: cadência agora vem do card, não é mais duplicada na config, e não existe
mais o conceito de "config única da agência" (cada card registrado é sua própria linha,
sem fan-out automático pra outros clientes na automação 1 — isso é exclusividade da
automação 2, que já clona por natureza).

```sql
-- shape final (depois do ALTER de migração)
create table public.automation_configs (
  id uuid primary key default gen_random_uuid(),
  automation_key text not null
    check (automation_key in ('relatorio_trafego_semanal', 'provisionar_card_metricas')),
  target_task_id uuid not null references public.tasks(id) on delete cascade,
  performance_template_id text, -- só usado por relatorio_trafego_semanal
  active boolean not null default true,
  last_run_date date, -- idempotência diária
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index automation_configs_target_task_idx on public.automation_configs (target_task_id);
```

`on delete cascade` (em vez de `set null` do v1): se o card-alvo for apagado, o registro
da automação não faz sentido sozinho — some junto, evitando um registro órfão sem card
pra apontar.

## API (v2)

- `GET /api/admin/automations` — lista todas as automações registradas.
- `POST /api/admin/automations` — cria uma nova (`automationKey`, `targetTaskId`,
  `performanceTemplateId?`, `active?`).
- `PATCH /api/admin/automations/[id]` — atualiza campos de uma linha existente.
- `DELETE /api/admin/automations/[id]` — remove.
- `POST /api/admin/automations/run` — cron-only (`x-cron-secret`), roda o tick diário.
- `POST /api/admin/automations/provision` — fan-out síncrono da automação 2 (sem mudança).

## Em aberto / decisões deste redesign (marcadas pra revisão do usuário)

- **Plano de ação como card-alvo da automação 1** assume que o plano-modelo tem seu
  próprio `due_date`/`recurrence_cadence` pra disparar o clone — se o produto quiser um
  gatilho diferente pra planos (ex. manual, ou atrelado ao ciclo de outro card), isso
  muda a implementação dessa ramificação especificamente.
- **Elegibilidade sem conta mapeada vira `parada` com comentário**, não um silêncio —
  decisão deste redesign pra manter o princípio "todo erro de automação comenta e para",
  aplicado também à falta de configuração, não só falhas técnicas.

---

## v1 (histórico — arquitetura anterior, parcialmente implementada e substituída)

Status original: planejado em 2026-08-20, implementado (schema + código + UI) em
2026-08-20/21, **substituído pelo v2 acima em 2026-08-21 antes de qualquer deploy**.

Resumo do que v1 tinha e o v2 descartou: uma automação "Relatório de anúncios" que
criava e gerenciava **seu próprio** card recorrente por cliente elegível (sem o admin
escolher um card existente), configurada por uma única linha "da agência" com
cadência/dias-da-semana definidos na própria tela de Configurações, disparada por um
cron **semanal fixo**. A automação 2 (Provisionar card por cliente) já existia
igual ao v2 atual e não mudou de mecânica — só de onde vive na UI.

Arquivos que implementavam o v1 e foram reescritos no v2:
`lib/automations/execute.ts` (lógica de auto-criação de card por cliente elegível —
substituída pela lógica de ramificação por formato do card-alvo),
`lib/automations/run.ts` (loop por cliente elegível — substituído por loop por
`automation_configs` ativa com card vencendo hoje), `app/api/admin/automations/[key]`
(rota por chave+escopo — substituída por CRUD por `id`), `AutomationSettings.tsx` (2
cards fixos — substituído por lista + box pontilhada).
