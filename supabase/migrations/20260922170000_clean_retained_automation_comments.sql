-- User-authorized cleanup for the three retained deliveries. Preserve every
-- human comment (including Luiza's source feedback), archive the prior card
-- payloads, and remove only automation-generated thread noise before the
-- corrected PDF link is generated directly after the feedback.

begin;

create table if not exists public.retained_automation_comment_cleanup_archive_20260922 (
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
  step_ids uuid[];
  step_count integer;
  automated_count integer;
begin
  select array_agg(l.child_id), count(*) into step_ids, step_count
  from public.task_links l
  where l.parent_id = any(keep_ids)
    and l.relation_kind = 'workflow_step';
  if step_count <> 9 then
    raise exception 'Etapas retidas mudaram: esperava 9, encontrei %', step_count;
  end if;

  select count(*) into automated_count
  from public.tasks t
  cross join lateral jsonb_array_elements(coalesce(t.payload->'comments', '[]'::jsonb)) item
  where t.id = any(step_ids)
    and coalesce(item->>'author', '') = 'Automação';
  if automated_count <> 19 then
    raise exception 'Comentários automatizados mudaram: esperava 19, encontrei %', automated_count;
  end if;

  insert into public.retained_automation_comment_cleanup_archive_20260922(task_id, payload)
  select id, payload from public.tasks where id = any(step_ids);
  if (select count(*) from public.retained_automation_comment_cleanup_archive_20260922) <> 9 then
    raise exception 'Arquivamento incompleto dos comentários das etapas retidas';
  end if;

  update public.tasks t
  set payload = jsonb_set(
    coalesce(t.payload, '{}'::jsonb),
    '{comments}',
    coalesce((
      select jsonb_agg(item order by ordinality)
      from jsonb_array_elements(coalesce(t.payload->'comments', '[]'::jsonb)) with ordinality as c(item, ordinality)
      where coalesce(item->>'author', '') <> 'Automação'
    ), '[]'::jsonb),
    true
  ), updated_at = now()
  where t.id = any(step_ids);

  if exists (
    select 1 from public.tasks t
    cross join lateral jsonb_array_elements(coalesce(t.payload->'comments', '[]'::jsonb)) item
    where t.id = any(step_ids) and coalesce(item->>'author', '') = 'Automação'
  ) then
    raise exception 'Ainda existem comentários automatizados nas etapas retidas';
  end if;
end
$$;

commit;
