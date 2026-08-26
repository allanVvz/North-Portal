-- Editar e excluir um comentário da thread em tasks.payload.comments.
--
-- Espelham append_task_comment (20260814000001): security INVOKER, para que a
-- RLS de `tasks` continue decidindo quem pode escrever no card — a função não
-- concede nada que o chamador já não tivesse.
--
-- Comentários são elementos de um array JSONB e não têm id próprio. Em vez de
-- inventar um (e migrar os ~100 já existentes), a identificação é
-- índice + `at` esperado: se o carimbo naquela posição não for o que o cliente
-- viu, alguém comentou/apagou no meio do caminho e a operação falha em vez de
-- editar o comentário errado.

create or replace function public.edit_task_comment(
  p_task_id uuid,
  p_index int,
  p_expected_at text,
  p_text text
)
returns setof public.tasks language plpgsql security invoker set search_path = public as $$
declare
  current_at text;
begin
  if nullif(btrim(p_text), '') is null or length(p_text) > 2000 then
    raise exception 'Comentário inválido';
  end if;

  select payload->'comments'->p_index->>'at' into current_at
    from public.tasks where id = p_task_id;
  if current_at is null or current_at is distinct from p_expected_at then
    raise exception 'Comentário mudou desde que você abriu o card';
  end if;

  return query update public.tasks t set
    payload = jsonb_set(
      t.payload,
      array['comments', p_index::text],
      (t.payload->'comments'->p_index)
        || jsonb_build_object('text', btrim(p_text), 'edited_at', now())
    ),
    updated_at = now()
  where t.id = p_task_id
  returning t.*;
end $$;

create or replace function public.delete_task_comment(
  p_task_id uuid,
  p_index int,
  p_expected_at text
)
returns setof public.tasks language plpgsql security invoker set search_path = public as $$
declare
  current_at text;
begin
  select payload->'comments'->p_index->>'at' into current_at
    from public.tasks where id = p_task_id;
  if current_at is null or current_at is distinct from p_expected_at then
    raise exception 'Comentário mudou desde que você abriu o card';
  end if;

  return query update public.tasks t set
    payload = jsonb_set(
      t.payload, '{comments}',
      (t.payload->'comments') - p_index
    ),
    updated_at = now()
  where t.id = p_task_id
  returning t.*;
end $$;

grant execute on function public.edit_task_comment(uuid, int, text, text) to authenticated;
grant execute on function public.delete_task_comment(uuid, int, text) to authenticated;
