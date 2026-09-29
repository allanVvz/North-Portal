-- Salvar um card de Edição falhava com "Propriedade não permitida" (30/09,
-- "Cliente Passando Cartão — Edição"): o modal manda os revisores da Edição
-- (`reviewer_ids`) no payload_patch desde que a Edição passou a ter vários
-- revisores, mas a lista de chaves aceitas desta função ficou para trás.
-- Mesma função, com `reviewer_ids` aceito — e só como lista.
create or replace function public.merge_task_payload_patch(p_task_id uuid, p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare key text; value jsonb; next_payload jsonb;
begin
  next_payload := '{}'::jsonb;
  for key, value in select * from jsonb_each(coalesce(p_patch, '{}'::jsonb)) loop
    if key not in ('barTone','statusLabel','statusTone','formato','plataforma','hora','reviewer_ids') then raise exception 'Propriedade não permitida'; end if;
    if key = 'reviewer_ids' and value <> 'null'::jsonb and jsonb_typeof(value) <> 'array' then raise exception 'Revisores inválidos'; end if;
    if value = 'null'::jsonb then next_payload := next_payload || jsonb_build_object(key, null);
    else next_payload := next_payload || jsonb_build_object(key, value); end if;
  end loop;
  update public.tasks t set payload =
    (coalesce(t.payload, '{}'::jsonb) - array(select k from jsonb_each(next_payload) e(k,v) where v = 'null'::jsonb))
    || (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(next_payload) e(k,v) where v <> 'null'::jsonb),
    updated_at = now()
  where id = p_task_id;
end $$;

grant execute on function public.merge_task_payload_patch(uuid, jsonb) to authenticated;
