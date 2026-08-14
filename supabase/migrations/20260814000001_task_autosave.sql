create or replace function public.replace_task_assignees(p_task_id uuid, p_profile_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from public.task_assignees where task_id = p_task_id;
  insert into public.task_assignees(task_id, profile_id)
  select p_task_id, profile_id from (select distinct unnest(coalesce(p_profile_ids, '{}'::uuid[])) profile_id) x;
end $$;

create or replace function public.append_task_comment(p_task_id uuid, p_author_id uuid, p_text text)
returns setof public.tasks language plpgsql security invoker set search_path = public as $$
declare author_name text;
begin
  if nullif(btrim(p_text), '') is null or length(p_text) > 2000 then raise exception 'Comentário inválido'; end if;
  select coalesce(nullif(full_name, ''), 'Admin North') into author_name from public.profiles where id = p_author_id;
  return query update public.tasks t set
    payload = jsonb_set(coalesce(t.payload, '{}'::jsonb), '{comments}',
      coalesce(t.payload->'comments', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'author', coalesce(author_name, 'Admin North'), 'text', btrim(p_text), 'at', now()
      )), true),
    updated_at = now()
  where t.id = p_task_id and jsonb_array_length(coalesce(t.payload->'comments', '[]'::jsonb)) < 200
  returning t.*;
end $$;

grant execute on function public.replace_task_assignees(uuid, uuid[]) to authenticated;
grant execute on function public.append_task_comment(uuid, uuid, text) to authenticated;

create or replace function public.propagate_explicit_group_payload(p_parent_id uuid, p_current_id uuid, p_payload jsonb)
returns void language sql security invoker set search_path = public as $$
  update public.tasks t set payload =
    (p_payload - 'explicit_occurrence_dates' - 'explicit_date_group_id' - 'occurrence_date' - 'deferred_until_accessed' - 'accessed_at' - 'action_plan_id')
    || (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        from jsonb_each(coalesce(t.payload, '{}'::jsonb)) e
        where e.key = any(array['explicit_date_group_id','occurrence_date','deferred_until_accessed','accessed_at','action_plan_id'])),
    updated_at = now()
  where t.plan_id = p_parent_id and t.id <> p_current_id;
$$;

grant execute on function public.propagate_explicit_group_payload(uuid, uuid, jsonb) to authenticated;

create or replace function public.merge_task_payload_patch(p_task_id uuid, p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare key text; value jsonb; next_payload jsonb;
begin
  next_payload := '{}'::jsonb;
  for key, value in select * from jsonb_each(coalesce(p_patch, '{}'::jsonb)) loop
    if key not in ('barTone','statusLabel','statusTone','formato','plataforma','hora') then raise exception 'Propriedade não permitida'; end if;
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
