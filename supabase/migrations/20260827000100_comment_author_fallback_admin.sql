-- "Admin North" era o nome da conta de teste que virou conta real por
-- engano (apagada nesta mesma leva) — o fallback de autor de comentário não
-- deve continuar citando uma conta que não existe mais.
create or replace function public.append_task_comment(p_task_id uuid, p_author_id uuid, p_text text)
returns setof public.tasks language plpgsql security invoker set search_path = public as $$
declare author_name text;
begin
  if nullif(btrim(p_text), '') is null or length(p_text) > 2000 then raise exception 'Comentário inválido'; end if;
  select coalesce(nullif(full_name, ''), 'Admin') into author_name from public.profiles where id = p_author_id;
  return query update public.tasks t set
    payload = jsonb_set(coalesce(t.payload, '{}'::jsonb), '{comments}',
      coalesce(t.payload->'comments', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'author', coalesce(author_name, 'Admin'), 'text', btrim(p_text), 'at', now()
      )), true),
    updated_at = now()
  where t.id = p_task_id and jsonb_array_length(coalesce(t.payload->'comments', '[]'::jsonb)) < 200
  returning t.*;
end $$;

grant execute on function public.append_task_comment(uuid, uuid, text) to authenticated;
