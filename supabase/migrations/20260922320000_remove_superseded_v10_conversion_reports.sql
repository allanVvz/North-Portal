-- Retain only the three final v11 PDFs after their successful delivery.

begin;

create table if not exists public.superseded_v10_conversion_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  remove_ids uuid[] := array[
    '2e2a43a8-f0e2-4dbc-ab3d-acdd46a6f553'::uuid,
    '42f929ee-c245-4ce2-b455-8514cd6e7859'::uuid,
    '1d1eb0b6-587c-4e8f-bbe3-32868e9438f2'::uuid
  ];
begin
  if (select count(*) from public.documents where id = any(remove_ids)) <> 3 then
    raise exception 'Relatórios v10 inesperados';
  end if;
  if (select count(*) from public.documents where doc_type = 'relatorio') <> 6 then
    raise exception 'Conjunto de relatórios inesperado antes da retenção v11';
  end if;

  insert into public.superseded_v10_conversion_report_archive_20260922(document)
  select to_jsonb(d) from public.documents d where d.id = any(remove_ids);

  if (select count(*) from public.superseded_v10_conversion_report_archive_20260922) <> 3 then
    raise exception 'Arquivamento v10 incompleto';
  end if;

  delete from public.documents where id = any(remove_ids);

  if (select count(*) from public.documents where doc_type = 'relatorio') <> 3 then
    raise exception 'Retenção v11 incorreta';
  end if;
end
$$;

commit;
