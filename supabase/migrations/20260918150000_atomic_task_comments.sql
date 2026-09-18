-- Comentários idempotentes e escrita atômica de payload para a Entrega recorrente.
--
-- Problema (docs/reporting/report-pipeline.md, "Roteamento de comentários e
-- escrita atômica"):
--   1. As automações liam o `payload` do card, geravam o relatório (segundos) e
--      regravavam o `payload` INTEIRO. Qualquer comentário humano gravado nesse
--      intervalo era apagado.
--   2. Um comentário reenviado (retry de rede, clique duplo) virava dois.
--
-- Esta migration é ADITIVA: `append_task_comment(uuid, uuid, text)` continua
-- existindo, então um deploy antigo segue funcionando até o código novo subir.
-- Aplicar ANTES do deploy do código que chama as funções abaixo.

begin;

-- ---------------------------------------------------------------------------
-- 1. Comentário humano idempotente
-- ---------------------------------------------------------------------------
-- `p_comment_id` é gerado pelo cliente. Reenviar o mesmo id não grava outro
-- comentário: devolve `inserted = false` com a linha atual. A checagem mora no
-- WHERE do UPDATE; numa corrida com o mesmo id a segunda transação espera o
-- lock da linha e reavalia o WHERE contra a versão já gravada, então cai no
-- ramo `inserted = false`.
create or replace function public.append_task_comment_idempotent(
  p_task_id uuid,
  p_author_id uuid,
  p_text text,
  p_comment_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  author_name text;
  updated public.tasks;
  existing public.tasks;
begin
  if nullif(btrim(p_text), '') is null or length(p_text) > 2000 then
    raise exception 'Comentário inválido';
  end if;
  if p_comment_id is not null and (length(p_comment_id) < 8 or length(p_comment_id) > 64) then
    raise exception 'Identificador de comentário inválido';
  end if;

  select coalesce(nullif(full_name, ''), 'Admin') into author_name
  from public.profiles where id = p_author_id;

  update public.tasks t set
    payload = jsonb_set(
      coalesce(t.payload, '{}'::jsonb),
      '{comments}',
      coalesce(t.payload->'comments', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(
        jsonb_build_object(
          'id', p_comment_id,
          'author', coalesce(author_name, 'Admin'),
          'author_id', p_author_id,
          'text', btrim(p_text),
          'at', now()
        )
      )),
      true
    ),
    updated_at = now()
  where t.id = p_task_id
    and jsonb_array_length(coalesce(t.payload->'comments', '[]'::jsonb)) < 200
    and (
      p_comment_id is null
      or not (coalesce(t.payload->'comments', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', p_comment_id)))
    )
  returning t.* into updated;

  if updated.id is not null then
    return jsonb_build_object('inserted', true, 'task', to_jsonb(updated));
  end if;

  select * into existing from public.tasks where id = p_task_id;
  if existing.id is not null
     and p_comment_id is not null
     and coalesce(existing.payload->'comments', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', p_comment_id)) then
    return jsonb_build_object('inserted', false, 'task', to_jsonb(existing));
  end if;

  -- Tarefa inexistente ou thread no limite de 200: mesmo contrato da função
  -- antiga (nenhuma linha) — quem chama trata como 404.
  return null;
end
$$;

grant execute on function public.append_task_comment_idempotent(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Escrita atômica de payload para automações
-- ---------------------------------------------------------------------------
-- Substitui "ler payload → montar array em memória → sobrescrever payload".
-- Sob `for update` a função (a) mescla só as chaves de `p_patch`, (b) remove só
-- as de `p_remove` e (c) acrescenta no máximo UM comentário ao final do thread
-- que está no banco AGORA — nunca uma cópia lida antes de Windsor/PDF.
-- Comentários e demais chaves gravados por humanos no intervalo sobrevivem.
--
-- `comments` nunca entra por `p_patch`/`p_remove`: o thread só muda por
-- comentário. Comentário com `p_comment_id` já presente não é repetido, então
-- re-execução da mesma ação da automação é inofensiva.
--
-- Só o service role executa (as automações rodam sem sessão).
create or replace function public.automation_task_payload_update(
  p_task_id uuid,
  p_comment_text text default null,
  p_comment_id text default null,
  p_comment_author text default 'Automação',
  p_patch jsonb default '{}'::jsonb,
  p_remove text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  remove_keys text[] := coalesce(p_remove, '{}'::text[]);
  existing public.tasks;
  updated public.tasks;
  thread jsonb;
  next_payload jsonb;
  added boolean := false;
begin
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'Patch de payload inválido';
  end if;
  if patch ? 'comments' or 'comments' = any (remove_keys) then
    raise exception 'O thread de comentários só muda por comentário';
  end if;
  if p_comment_text is not null and nullif(btrim(p_comment_text), '') is null then
    raise exception 'Comentário inválido';
  end if;
  if p_comment_id is not null and (length(p_comment_id) < 8 or length(p_comment_id) > 128) then
    raise exception 'Identificador de comentário inválido';
  end if;

  select * into existing from public.tasks where id = p_task_id for update;
  if existing.id is null then
    return null;
  end if;

  next_payload := (coalesce(existing.payload, '{}'::jsonb) - remove_keys) || patch;

  if p_comment_text is not null then
    thread := coalesce(existing.payload->'comments', '[]'::jsonb);
    if p_comment_id is null
       or not (thread @> jsonb_build_array(jsonb_build_object('id', p_comment_id))) then
      thread := thread || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id', p_comment_id,
        'author', coalesce(nullif(p_comment_author, ''), 'Automação'),
        'text', p_comment_text,
        -- Mesmo formato ISO-8601 com Z que o JS grava (ver comment-at-formato-duplo).
        'at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )));
      -- Mantém os 200 mais recentes, como o JS fazia com slice(-200).
      if jsonb_array_length(thread) > 200 then
        select coalesce(jsonb_agg(recent.entry order by recent.ord), '[]'::jsonb) into thread
        from (
          select element.entry, element.ord
          from jsonb_array_elements(thread) with ordinality as element(entry, ord)
          order by element.ord desc
          limit 200
        ) recent;
      end if;
      next_payload := jsonb_set(next_payload, '{comments}', thread, true);
      added := true;
    end if;
  end if;

  update public.tasks
  set payload = next_payload, updated_at = now()
  where id = p_task_id
  returning * into updated;

  return jsonb_build_object('inserted', added, 'task', to_jsonb(updated));
end
$$;

revoke all on function public.automation_task_payload_update(uuid, text, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.automation_task_payload_update(uuid, text, text, text, jsonb, text[]) to service_role;

commit;
