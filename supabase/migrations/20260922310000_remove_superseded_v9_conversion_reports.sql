-- Retain only the three corrected v10 PDFs after their successful delivery.

begin;

create table if not exists public.superseded_v9_conversion_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  remove_ids uuid[] := array[
    '2f9af48f-e949-4158-b497-45037eb500ca'::uuid,
    'f495af1c-3ce5-458e-b3be-df0e0b7e2f82'::uuid,
    '596a074d-a842-4977-9af9-6461ba42448f'::uuid
  ];
begin
  if (select count(*) from public.documents where id = any(remove_ids)) <> 3 then
    raise exception 'Relatórios v9 inesperados';
  end if;
  if (select count(*) from public.documents where doc_type = 'relatorio') <> 6 then
    raise exception 'Conjunto de relatórios inesperado antes da retenção v10';
  end if;

  insert into public.superseded_v9_conversion_report_archive_20260922(document)
  select to_jsonb(d) from public.documents d where d.id = any(remove_ids);

  if (select count(*) from public.superseded_v9_conversion_report_archive_20260922) <> 3 then
    raise exception 'Arquivamento v9 incompleto';
  end if;

  delete from public.documents where id = any(remove_ids);

  if (select count(*) from public.documents where doc_type = 'relatorio') <> 3 then
    raise exception 'Retenção v10 incorreta';
  end if;
end
$$;

commit;
