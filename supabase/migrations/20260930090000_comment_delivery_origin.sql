-- De qual Entrega veio um comentário gravado numa etapa COMPARTILHADA (30/09).
--
-- Reels e Carrossel do "Evento Baita 10/10" dividem as mesmas etapas (Roteiro,
-- Captação, Edição). Comentar em qualquer um grava na Edição comum, e os dois
-- cards passavam a mostrar os mesmos arquivos e a mesma capa. O comentário
-- ganha `for_task_id` (a Entrega de origem); quem monta capa e arquivos de uma
-- Entrega ignora o que foi marcado para outra.
--
-- Atualização atômica de UM comentário (linha travada), achado pelo `id` ou,
-- nos antigos sem id, pelo carimbo `at`. `p_for_task_id` nulo desmarca.
create or replace function public.tag_task_comment_origin(
  p_task_id uuid,
  p_comment_key text,
  p_for_task_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing public.tasks;
  thread jsonb;
  position int;
begin
  if p_comment_key is null or length(p_comment_key) < 8 or length(p_comment_key) > 128 then
    raise exception 'Comentário inválido';
  end if;
  select * into existing from public.tasks where id = p_task_id for update;
  if existing.id is null then
    return false;
  end if;
  thread := coalesce(existing.payload->'comments', '[]'::jsonb);
  select element.ord - 1 into position
  from jsonb_array_elements(thread) with ordinality as element(entry, ord)
  where element.entry->>'id' = p_comment_key or element.entry->>'at' = p_comment_key
  order by element.ord desc
  limit 1;
  if position is null then
    return false;
  end if;
  thread := jsonb_set(
    thread,
    array[position::text],
    case when p_for_task_id is null then (thread->position) - 'for_task_id'
         else (thread->position) || jsonb_build_object('for_task_id', p_for_task_id) end
  );
  update public.tasks set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{comments}', thread) where id = p_task_id;
  return true;
end;
$$;

grant execute on function public.tag_task_comment_origin(uuid, text, uuid) to authenticated;
grant execute on function public.tag_task_comment_origin(uuid, text, uuid) to service_role;
