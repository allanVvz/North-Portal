-- User-authorized cleanup: the three retained deliveries recovered
-- successfully, so their transient automation failure notices are removed.
-- Payloads are retained for audit before the visible comments are changed.

begin;

create table if not exists public.recovered_automation_error_comment_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  task_id uuid not null,
  payload jsonb not null
);

do $$
declare
  keep_ids uuid[] := array[
    'b805b260-c8d6-5f22-9d2a-6437ae30263e'::uuid,
    'b27d8131-2347-525d-a79a-dd0c334138ea'::uuid,
    '62593d51-e48e-52fa-a63a-7ff492bf5927'::uuid
  ];
  error_count integer;
begin
  select count(*) into error_count
  from public.tasks t
  cross join lateral jsonb_array_elements(coalesce(t.payload->'comments', '[]'::jsonb)) item
  where t.id = any(keep_ids)
    and coalesce(item->>'author', '') = 'Automação'
    and coalesce(item->>'text', '') like 'Falha ao processar o feedback da semana:%';
  if error_count <> 3 then
    raise exception 'Avisos de falha recuperados mudaram: esperava 3, encontrei %', error_count;
  end if;

  insert into public.recovered_automation_error_comment_archive_20260922(task_id, payload)
  select id, payload from public.tasks where id = any(keep_ids);
  if (select count(*) from public.recovered_automation_error_comment_archive_20260922) <> 3 then
    raise exception 'Arquivamento incompleto dos avisos recuperados';
  end if;

  update public.tasks t
  set payload = jsonb_set(
    coalesce(t.payload, '{}'::jsonb), '{comments}',
    coalesce((
      select jsonb_agg(item order by ordinality)
      from jsonb_array_elements(coalesce(t.payload->'comments', '[]'::jsonb)) with ordinality as c(item, ordinality)
      where not (
        coalesce(item->>'author', '') = 'Automação'
        and coalesce(item->>'text', '') like 'Falha ao processar o feedback da semana:%'
      )
    ), '[]'::jsonb), true
  ), updated_at = now()
  where t.id = any(keep_ids);

  if exists (
    select 1 from public.tasks t
    cross join lateral jsonb_array_elements(coalesce(t.payload->'comments', '[]'::jsonb)) item
    where t.id = any(keep_ids)
      and coalesce(item->>'author', '') = 'Automação'
      and coalesce(item->>'text', '') like 'Falha ao processar o feedback da semana:%'
  ) then
    raise exception 'Persistiu aviso de falha recuperado';
  end if;
end
$$;

commit;
