-- Publicar virou um CARD, então as peças históricas viram esse card.
--
-- Quando "Publicado" era um estágio, um criativo que foi ao ar era um card só
-- com `status = 'concluido'`. O estágio saiu (ver
-- 20260829120000_publicado_removido_e_rls_hot_path.sql) e publicar passou a ser
-- a última ETAPA da corrente de uma Entrega — e uma etapa é um card, com
-- `subtype = 'publicacao'`.
--
-- As 24 peças históricas ficaram no meio do caminho: sabem QUANDO foram ao ar
-- (`payload.publicado_em`, gravado por aquela migração) mas não estavam
-- marcadas como o que são. Esta migração fecha isso — o card que já existe
-- passa a ser o card de Publicação.
--
-- Um card só, e nenhum card inventado. A alternativa que chegou a ser escrita
-- gerava as quatro etapas (Roteiro, Captação, Edição, Publicação) para cada
-- peça: 96 cards sintéticos, sem comentário, sem anexo e sem responsável real,
-- 24 deles visíveis no portal do cliente. Foi descartada — o trabalho existiu,
-- mas nunca existiu como card, e inventar card vazio para contar essa história
-- suja o quadro de quem usa.
--
-- Sem pai em `task_links` de propósito: essas peças não têm corrente, e um
-- card de etapa sem pai é inofensivo — `chainDelivery` fica nulo e a caixa de
-- corrente não renderiza; `reconcileFlows` acha zero pais e volta na hora.
--
-- Reversível: `payload.publicado_em` marca exatamente quais 24 são.
--   update public.tasks set subtype = null where payload ? 'publicado_em';

update public.tasks
   set subtype = 'publicacao'
 where kind = 'criativo'
   and payload ? 'publicado_em'
   and subtype is null;
