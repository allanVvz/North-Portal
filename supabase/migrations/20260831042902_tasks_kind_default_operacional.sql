-- O default da coluna `tasks.kind` era 'criativo' — sobra de antes do modelo de
-- cinco tipos (quando "criativo" era o tipo principal). Hoje "criativo" é a
-- Entrega, um pai de corrente de etapas: um INSERT que esquecesse de passar
-- `kind` criaria uma Entrega silenciosamente, com todo o comportamento de fluxo
-- por trás.
--
-- Toda criação real passa `kind` explícito (POST /api/admin/tasks, recorrência,
-- checkpoint, kickoff, automação), então nenhuma linha existente é afetada — só
-- muda o que acontece com um insert futuro que esqueça o campo: vira uma Tarefa
-- comum ('operacional'), que é o default são.

alter table public.tasks alter column kind set default 'operacional';
