-- The three v4 artifacts are the only client-facing reports retained after
-- the corrected regeneration. Prior v1/v3 artifacts are archived for audit
-- before their document records are removed.

begin;

create table if not exists public.superseded_regenerated_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  keep_ids uuid[] := array[
    '73717ac7-5a8a-40c6-8734-46c1ff6b1736'::uuid,
    '2b9f87ae-548b-4731-b051-f9fc8ccf8ea5'::uuid,
    '33ae8f45-8af6-4530-957e-b5e7e5a84374'::uuid
  ];
  remove_count integer;
begin
  select count(*) into remove_count
  from public.documents
  where doc_type = 'relatorio' and id <> all(keep_ids);
  if remove_count <> 6 then
    raise exception 'Relatórios superseded mudaram: esperava remover 6, encontrei %', remove_count;
  end if;

  insert into public.superseded_regenerated_report_archive_20260922(document)
  select to_jsonb(d) from public.documents d
  where d.doc_type = 'relatorio' and d.id <> all(keep_ids);
  if (select count(*) from public.superseded_regenerated_report_archive_20260922) <> 6 then
    raise exception 'Arquivamento incompleto dos relatórios superseded';
  end if;

  delete from public.documents
  where doc_type = 'relatorio' and id <> all(keep_ids);

  if (select count(*) from public.documents where doc_type = 'relatorio') <> 3 then
    raise exception 'Retenção de relatórios incorreta após limpeza';
  end if;
end
$$;

commit;
