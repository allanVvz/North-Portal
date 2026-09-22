-- The corrected v5 PDFs were generated successfully. Retain only those three
-- client-facing artifacts and archive the superseded v4 document metadata.

begin;

create table if not exists public.superseded_v4_conversion_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  remove_ids uuid[] := array[
    '2b9f87ae-548b-4731-b051-f9fc8ccf8ea5'::uuid,
    '33ae8f45-8af6-4530-957e-b5e7e5a84374'::uuid,
    '73717ac7-5a8a-40c6-8734-46c1ff6b1736'::uuid
  ];
  remove_count integer;
begin
  select count(*) into remove_count from public.documents where id = any(remove_ids);
  if remove_count <> 3 then
    raise exception 'Relatórios v4 mudaram: esperava 3, encontrei %', remove_count;
  end if;
  if (select count(*) from public.documents where doc_type = 'relatorio') <> 6 then
    raise exception 'Conjunto de relatórios inesperado antes da retenção v5';
  end if;

  insert into public.superseded_v4_conversion_report_archive_20260922(document)
  select to_jsonb(d) from public.documents d where d.id = any(remove_ids);
  if (select count(*) from public.superseded_v4_conversion_report_archive_20260922) <> 3 then
    raise exception 'Arquivamento incompleto dos relatórios v4';
  end if;

  delete from public.documents where id = any(remove_ids);
  if (select count(*) from public.documents where doc_type = 'relatorio') <> 3 then
    raise exception 'Retenção de relatórios v5 incorreta';
  end if;
end
$$;

commit;
