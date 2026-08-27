-- Grava o id do autor junto do nome nos comentários novos.
--
-- Motivação: a foto do autor no card era resolvida casando o NOME do
-- comentário com o nome do perfil (ver app/avatar/README.md), porque
-- `payload.comments[].author` sempre foi texto congelado. Isso erra em três
-- casos reais — perfil renomeado depois do comentário, dois homônimos, e
-- comentário de automação que não é pessoa.
--
-- A função já recebia `p_author_id` para resolver o nome; ela só não o
-- guardava. Passa a guardar, e a resolução da foto vira exata para tudo que
-- for escrito daqui em diante.
--
-- O que NÃO muda, de propósito:
--
--   * `author` continua sendo gravado como texto. É ele que mantém o
--     comentário legível depois que a conta é apagada, e é o único autor que
--     comentário de automação tem. `author_id` é um extra, não um substituto.
--   * Os ~100 comentários antigos não são reescritos. Eles não têm id porque
--     naquele momento não havia — inventar um agora seria adivinhar, e o
--     fallback por nome já os atende. Comentário antigo continua exatamente
--     como está.
--   * edit_task_comment (20260826120000) não precisa de ajuste: ele mescla o
--     objeto com `||`, então `author_id` sobrevive à edição sozinho.

create or replace function public.append_task_comment(p_task_id uuid, p_author_id uuid, p_text text)
returns setof public.tasks language plpgsql security invoker set search_path = public as $$
declare author_name text;
begin
  if nullif(btrim(p_text), '') is null or length(p_text) > 2000 then raise exception 'Comentário inválido'; end if;
  select coalesce(nullif(full_name, ''), 'Admin') into author_name from public.profiles where id = p_author_id;
  return query update public.tasks t set
    payload = jsonb_set(coalesce(t.payload, '{}'::jsonb), '{comments}',
      coalesce(t.payload->'comments', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'author', coalesce(author_name, 'Admin'), 'author_id', p_author_id, 'text', btrim(p_text), 'at', now()
      )), true),
    updated_at = now()
  where t.id = p_task_id and jsonb_array_length(coalesce(t.payload->'comments', '[]'::jsonb)) < 200
  returning t.*;
end $$;

grant execute on function public.append_task_comment(uuid, uuid, text) to authenticated;
