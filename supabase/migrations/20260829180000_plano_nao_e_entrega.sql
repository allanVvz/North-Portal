-- Um card não pode ser Plano de Ação e Entrega ao mesmo tempo.
--
-- Os dois são pais que rolam progresso, mas por regras diferentes: o Plano
-- divide pelos membros que tem, a Entrega pelo peso congelado do molde. Um card
-- que fosse os dois não teria resposta única para "quanto está pronto" — e a
-- tela também não: hoje, se alguém forçar a combinação, o modal renderiza a
-- caixa de membros do plano E um "Carregando etapas…" que nunca termina,
-- porque `findType` devolve o tipo Plano, que não tem subtipo nenhum.
--
-- Nada impedia isso até agora: `taskPayloadSchema` é `.passthrough()`, e nem o
-- POST nem o PATCH olhavam `flow_parent`. Um PATCH podia marcar a chave num
-- plano existente agora mesmo.
--
-- `not valid` primeiro e `validate` depois de propósito: `validate` toma um
-- lock fraco (SHARE UPDATE EXCLUSIVE) e não bloqueia escrita concorrente numa
-- tabela viva. Conferido antes de aplicar: zero linhas violam hoje.

alter table public.tasks
  add constraint tasks_plano_nao_e_entrega
  check (not (kind = 'plano_acao' and coalesce(payload->>'flow_parent', '') = 'true'))
  not valid;

alter table public.tasks validate constraint tasks_plano_nao_e_entrega;

comment on constraint tasks_plano_nao_e_entrega on public.tasks is
  'Plano agrega membros; Entrega agrega etapas por um molde congelado. Ser os dois nao tem progresso definido.';
