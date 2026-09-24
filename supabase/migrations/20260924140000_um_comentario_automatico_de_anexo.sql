-- Um comentário automático de anexo por card, não um por geração.
--
-- A versão de 20260919010000 tinha duas lacunas que só apareceram quando a
-- regeração de manutenção entrou em cena (24/09):
--
--   1. O casamento de prefixos não conhecia `ads-rerender:%`, o id da
--      regeração de manutenção. Ela caía fora da substituição e virava sempre
--      um comentário novo.
--   2. Mesmo entre os prefixos conhecidos, só o ÚLTIMO era removido. Com três
--      comentários automáticos acumulados (o que de fato aconteceu nos três
--      cards de tráfego de 15–21/09: `ads-revision` de 22/09, `ads-rerender`
--      chaveado por revisão e `ads-rerender` chaveado por período), substituir
--      um deixava dois para trás.
--
-- Como cada card de etapa cobre UMA semana, todo comentário automático de
-- anexo nele fala do mesmo relatório: manter mais de um é sempre duplicata.
-- A função passa a remover todos os automáticos do mesmo tipo e inserir o
-- novo no lugar. Comentário humano nunca é tocado — é o que a RPC já
-- protegia e continua protegendo, inclusive o escrito enquanto o PDF
-- renderizava.
--
-- `report_attachment_replacements` registra o último removido, como antes; o
-- texto integral dos demais fica no histórico dessa tabela pelas execuções
-- anteriores.

begin;

create or replace function public.replace_automatic_report_attachment(
  p_task_id uuid,
  p_report_kind text,
  p_comment_id text,
  p_comment_text text,
  p_comment_author text default 'Northia'
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
  old_comment jsonb;
  old_id text;
  item jsonb;
  item_id text;
  new_comment jsonb;
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

    new_comment := jsonb_strip_nulls(jsonb_build_object(
      'id', p_comment_id,
      'author', coalesce(nullif(btrim(p_comment_author), ''), 'Northia'),
      'text', btrim(p_comment_text),
      'at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
    kept := kept || jsonb_build_array(new_comment);
    inserted := true;

    insert into public.report_attachment_replacements
      (task_id, report_kind, previous_comment_id, previous_comment,
       replacement_comment_id, replacement_comment)
    values (p_task_id, p_report_kind, old_id, old_comment, p_comment_id, new_comment)
    on conflict (task_id, report_kind, replacement_comment_id) do nothing;

    update public.tasks
       set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{comments}', kept, true),
           updated_at = now()
     where id = p_task_id;
  end if;

  select * into current_task from public.tasks where id = p_task_id;
  return jsonb_build_object('inserted', inserted, 'task', to_jsonb(current_task),
    'replaced_comment_id', old_id);
end
$$;

revoke all on function public.replace_automatic_report_attachment(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.replace_automatic_report_attachment(uuid, text, text, text, text)
  to service_role;

commit;
