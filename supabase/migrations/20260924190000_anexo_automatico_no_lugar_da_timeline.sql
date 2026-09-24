-- Comentário automático de anexo no lugar certo da timeline (24/09).
--
-- A regeração de MANUTENÇÃO (redesenhar o PDF com o código atual, sem pedido
-- humano) passava por esta RPC e ganhava a hora de agora, no fim do thread.
-- No thread da família isso punha o relatório de anúncios DEPOIS do feedback
-- que ele mesmo originou — anúncios 24/09 16:49, feedback 22/09 10:45 — e a
-- cascata (anúncios → feedback → conversão) ficava invertida.
--
-- `p_comment_at` opcional: quem chama diz o momento do evento que o comentário
-- representa. Sem ele, continua sendo agora (uma revisão pedida por alguém É
-- um evento novo). Com ele, o comentário entra na posição cronológica do
-- array, antes do primeiro comentário posterior — nunca no fim por padrão.
--
-- A assinatura muda (6 parâmetros), então a de 5 sai: duas sobrecargas com
-- default deixariam a chamada por nome ambígua no PostgREST.

begin;

drop function if exists public.replace_automatic_report_attachment(uuid, text, text, text, text);

create or replace function public.replace_automatic_report_attachment(
  p_task_id uuid,
  p_report_kind text,
  p_comment_id text,
  p_comment_text text,
  p_comment_author text default 'North Ai',
  p_comment_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_task public.tasks;
  comments jsonb;
  kept jsonb := '[]'::jsonb;
  ordered jsonb := '[]'::jsonb;
  old_comment jsonb;
  old_id text;
  item jsonb;
  item_id text;
  new_comment jsonb;
  new_at timestamptz;
  placed boolean := false;
  inserted boolean := false;
begin
  if p_report_kind not in ('ads', 'conversion') then
    raise exception 'Tipo de relatório inválido';
  end if;
  if nullif(btrim(p_comment_id), '') is null or length(p_comment_id) > 128 then
    raise exception 'Identificador de comentário inválido';
  end if;
  if nullif(btrim(p_comment_text), '') is null or length(p_comment_text) > 4000 then
    raise exception 'Comentário inválido';
  end if;

  select * into current_task from public.tasks where id = p_task_id for update;
  if current_task.id is null then return null; end if;

  comments := coalesce(current_task.payload->'comments', '[]'::jsonb);
  if not (comments @> jsonb_build_array(jsonb_build_object('id', p_comment_id))) then
    for item in select value from jsonb_array_elements(comments)
    loop
      item_id := coalesce(item->>'id', '');
      if (p_report_kind = 'ads' and (
             item_id like 'ads-report:%'
          or item_id like 'ads-revision:%'
          or item_id like 'ads-rerender:%'))
      or (p_report_kind = 'conversion' and (
             item_id like 'conversion-report:%'
          or item_id like 'sales-report:%'))
      then
        old_comment := item; old_id := item_id;
      else
        kept := kept || jsonb_build_array(item);
      end if;
    end loop;

    new_at := coalesce(p_comment_at, clock_timestamp());
    new_comment := jsonb_strip_nulls(jsonb_build_object(
      'id', p_comment_id,
      'author', coalesce(nullif(btrim(p_comment_author), ''), 'North Ai'),
      'text', btrim(p_comment_text),
      'at', to_char(new_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));

    -- Posição cronológica: antes do primeiro comentário posterior. `at` vem em
    -- dois formatos no banco (RPC e JS), por isso a comparação é sempre como
    -- timestamptz, nunca como texto. Comentário sem `at` válido fica onde está.
    for item in select value from jsonb_array_elements(kept)
    loop
      if not placed and (item->>'at') is not null and (item->>'at')::timestamptz > new_at then
        ordered := ordered || jsonb_build_array(new_comment);
        placed := true;
      end if;
      ordered := ordered || jsonb_build_array(item);
    end loop;
    if not placed then ordered := ordered || jsonb_build_array(new_comment); end if;
    inserted := true;

    insert into public.report_attachment_replacements
      (task_id, report_kind, previous_comment_id, previous_comment,
       replacement_comment_id, replacement_comment)
    values (p_task_id, p_report_kind, old_id, old_comment, p_comment_id, new_comment)
    on conflict (task_id, report_kind, replacement_comment_id) do nothing;

    update public.tasks
       set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{comments}', ordered, true),
           updated_at = now()
     where id = p_task_id;
  end if;

  select * into current_task from public.tasks where id = p_task_id;
  return jsonb_build_object('inserted', inserted, 'task', to_jsonb(current_task),
    'replaced_comment_id', old_id);
end
$$;

revoke all on function public.replace_automatic_report_attachment(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_automatic_report_attachment(uuid, text, text, text, text, timestamptz)
  to service_role;

commit;
