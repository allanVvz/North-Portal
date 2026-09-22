-- User-authorized cleanup: retain only the three current conversion PDFs
-- (CRIS, Baita and FALKE) and remove every older client-facing report PDF.
-- Immutable conversion snapshots stay untouched; this migration archives the
-- relational metadata before removing public documents and their auto-comments.

begin;

create table if not exists public.report_document_deletion_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null,
  task_id uuid,
  task_payload jsonb
);

do $$
declare
  keep_ids uuid[] := array[
    '6895f2ca-b49c-4208-83e8-901d7d53114d'::uuid, -- CRIS
    'ca2d8610-765e-4386-9c52-bd3a63b83a94'::uuid, -- Baita
    '7f12c720-b1b9-4a5d-ab0c-f194f52fdd3c'::uuid  -- FALKE
  ];
  delete_count integer;
  archive_count integer;
begin
  select count(*) into delete_count
  from public.documents
  where doc_type = 'relatorio' and id <> all(keep_ids);
  if delete_count <> 28 then
    raise exception 'Allowlist de retenção mudou: esperava remover 28 documentos, encontrei %', delete_count;
  end if;

  insert into public.report_document_deletion_archive_20260922(document, task_id, task_payload)
  select to_jsonb(d), d.task_id, t.payload
  from public.documents d
  left join public.tasks t on t.id = d.task_id
  where d.doc_type = 'relatorio' and d.id <> all(keep_ids);

  select count(*) into archive_count from public.report_document_deletion_archive_20260922;
  if archive_count <> 28 then
    raise exception 'Arquivamento incompleto: esperava 28 documentos, encontrei %', archive_count;
  end if;

  -- Preserve human comments. Generated attachment comments are the only card
  -- content removed, and only on cards that lost an archived report document.
  update public.tasks t
  set payload = jsonb_set(
    coalesce(t.payload, '{}'::jsonb),
    '{comments}',
    coalesce((
      select jsonb_agg(item)
      from jsonb_array_elements(coalesce(t.payload->'comments', '[]'::jsonb)) item
      where coalesce(item->>'id', '') not like 'ads-report:%'
        and coalesce(item->>'id', '') not like 'ads-revision:%'
        and coalesce(item->>'id', '') not like 'conversion-report:%'
        and coalesce(item->>'id', '') not like 'sales-report:%'
    ), '[]'::jsonb),
    true
  ), updated_at = now()
  where t.id in (
    select distinct task_id from public.report_document_deletion_archive_20260922
    where task_id is not null
  );

  delete from public.documents
  where doc_type = 'relatorio' and id <> all(keep_ids);

  if (select count(*) from public.documents where id = any(keep_ids)) <> 3 then
    raise exception 'Documentos retidos não estão íntegros';
  end if;
end
$$;

commit;
