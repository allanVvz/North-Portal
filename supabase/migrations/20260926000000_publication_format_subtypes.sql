-- Formatos de publicacao (reels/story/carrossel/anuncio/banner) existiam so
-- informalmente como rotulo de um contador de quantidade
-- (app/admin/contentPlan.ts), gerando tarefa kind=operacional generica, sem
-- subtype proprio. Cada um ganha uma linha real de task_types, filha de
-- 'tarefa' (mesmo pai de roteiro/captacao/edicao/publicacao), com icone
-- proprio (coluna task_types.icon, ate agora so usada pela raiz 'entrega')
-- e servem tanto de subtype de uma etapa comum quanto de classificacao da
-- propria Entrega ("Entrega tipo Reels").
insert into public.task_types (
  parent_id, key, label, order_index, behavior, creatable, active,
  lead_days, progress_weight, client_visible, show_in_performance, icon, tone
)
select
  (select id from public.task_types where key = 'tarefa'),
  v.key, v.label, v.order_index, 'simples', true, true,
  2, 1, true, true, v.icon, null
from (values
  ('reels', 'Reels', 121, '▶'),
  ('story', 'Story', 122, '◔'),
  ('carrossel', 'Carrossel', 123, '▦'),
  ('anuncio', 'Anúncio', 124, '◎'),
  ('banner', 'Banner', 125, '▬')
) as v(key, label, order_index, icon)
where not exists (select 1 from public.task_types t where t.key = v.key);
