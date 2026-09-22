-- User-authorized replacement of the three v7 links before the compact-list
-- v8 PDF is attached. Human feedback remains untouched.

begin;

create table if not exists public.superseded_v7_report_attachment_comment_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  task_id uuid not null,
  payload jsonb not null
);

do $$
declare
  task_ids uuid[] := array[
    'c198baa7-36a0-599f-8c0f-5474ec6385ca'::uuid,
    'a1b27680-77d4-5771-94e0-663ca839ca34'::uuid,
    '8b6224aa-5276-5850-b25d-12d17dfc2f6b'::uuid
  ];
  link_count integer;
begin
  select count(*) into link_count from public.tasks t cross join lateral jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) item
  where t.id = any(task_ids) and coalesce(item->>'id','') like 'conversion-report:%segment-summary-v7';
  if link_count <> 3 then raise exception 'Links v7 mudaram: esperava 3, encontrei %', link_count; end if;
  insert into public.superseded_v7_report_attachment_comment_archive_20260922(task_id,payload) select id,payload from public.tasks where id=any(task_ids);
  if (select count(*) from public.superseded_v7_report_attachment_comment_archive_20260922) <> 3 then raise exception 'Arquivamento de links v7 incompleto'; end if;
  update public.tasks t set payload=jsonb_set(coalesce(t.payload,'{}'::jsonb),'{comments}',coalesce((
    select jsonb_agg(item order by ordinality) from jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) with ordinality as c(item,ordinality)
    where coalesce(item->>'id','') not like 'conversion-report:%segment-summary-v7'
  ),'[]'::jsonb),true),updated_at=now() where t.id=any(task_ids);
end
$$;

commit;
