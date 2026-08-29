-- Cinco portas de criação, e só elas.
--
-- Eram seis tipos de topo e três comportamentos, com relação acidental entre
-- eles: `agendamento` e `planejamento` existiam só para carregar subtipos, sem
-- nenhuma regra própria. O vocabulário passa a ser o mesmo que a tela já
-- falava — Tarefa, Plano, Entrega — mais o Checkpoint, que nasce do onboarding
-- e agora também pode ser criado à mão.
--
-- "Rotina" NÃO entra aqui. Recorrência é a coluna `recurrence_cadence`,
-- ortogonal ao tipo, e é justamente isso que permite uma ENTREGA recorrente —
-- um `kind = 'rotina'` tornaria a combinação irrepresentável. Rotina é a
-- quinta porta na interface (ver ROTINA_OPTION em app/admin/TaskModal.tsx),
-- não uma linha nesta tabela. O CHECK de `behavior` continua sendo
-- ('entrega','plano','simples') e não precisa mudar.

-- Tarefa: o tipo mais usado, o default da criação, e sem subtipo.
update public.task_types set label = 'Tarefa', order_index = 10
 where key = 'operacional' and parent_id is null;

update public.task_types set label = 'Plano', order_index = 20
 where key = 'plano_acao' and parent_id is null;

-- Entrega. As KEYS das quatro etapas NÃO mudam, só o rótulo do pai: o slot em
-- task_links, o subtype do card e o id determinístico (lib/derivedTaskId.ts)
-- são todos derivados da key, então renomear órfãria toda entrega em voo.
update public.task_types set label = 'Entrega', order_index = 30
 where key = 'criativo' and parent_id is null;

-- O próprio seed original chamava de bug ele NÃO ser criável.
update public.task_types
   set label = 'Checkpoint', order_index = 40, creatable = true
 where key = 'checkpoint_comercial' and parent_id is null;

-- Os cards dos dois tipos aposentados viram Tarefa. Zerar o subtipo é o que os
-- tira da varredura de lib/flows/reconcile.ts, que considera candidato a
-- cascata QUALQUER card com subtipo concluído.
update public.tasks
   set kind = 'operacional', subtype = null
 where kind in ('agendamento', 'planejamento');

-- Desativar, não apagar. `listTaskTypes` filtra por `active`, então some do
-- dropdown; e a linha continua ali caso alguma leitura antiga precise resolver
-- um rótulo. Apagar seria irreversível por nada.
update public.task_types set active = false
 where parent_id in (
   select id from public.task_types
    where parent_id is null and key in ('agendamento', 'planejamento')
 );
update public.task_types set active = false
 where parent_id is null and key in ('agendamento', 'planejamento');

-- Tarefa sem subtipo: `gestao` e `relatorio_trafego` saem do dropdown pelo
-- mesmo caminho. NÃO se apaga nem se zera o subtipo dos 27 cards de
-- `relatorio_trafego`: eles são alvo de automação e o rótulo continua
-- resolvendo pelo catálogo em código (SUBTYPE_LABEL).
update public.task_types set active = false
 where parent_id = (
   select id from public.task_types where key = 'operacional' and parent_id is null
 );
