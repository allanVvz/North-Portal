-- Trava o valor de status que saiu do vocabulário.
--
-- Postgres não remove valor de enum em lugar, e trocar o tipo inteiro é
-- inviável aqui: `ALTER TYPE` recusa uma coluna usada em definição de policy, e
-- `tasks.status` aparece em policies de DUAS tabelas (`tasks` e
-- `task_assignees`). Trocar o tipo exigiria dropar e recriar a RLS da tabela
-- mais quente do app, em produção, sem ambiente de ensaio — muito risco para
-- ganhar uma garantia que o TypeScript já dá em todo caminho de escrita.
--
-- Então o valor `concluido` fica órfão no enum, sem nenhuma linha usando, e uma
-- CHECK impede que ele volte a ser escrito por qualquer caminho.
--
-- ORDEM IMPORTA: esta migração só pode rodar DEPOIS que o deploy do código
-- estiver no ar. O código anterior tem `deliveryStatusOnFinish` devolvendo
-- "concluido"; com a CHECK ativa antes dele, toda entrega que conclui a última
-- etapa estoura, e `advanceFlowAfterUpdate` trata o erro jogando o card para
-- `parada` com um comentário — ou seja, cards reais de produção travados.

alter table public.tasks
  add constraint tasks_status_sem_concluido
  check (status <> 'concluido'::public.task_status);

comment on constraint tasks_status_sem_concluido on public.tasks is
  'Publicado deixou de ser estágio do funil (2026-08-29): publicar é a última etapa de uma Entrega. O valor segue no enum porque enum não perde valor em lugar.';
