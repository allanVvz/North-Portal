-- Retain only the three corrected v9 PDFs after their successful delivery.
-- Metadata is retained in an archive table before the active document rows go.

begin;

create table if not exists public.superseded_v8_conversion_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  remove_ids uuid[] := array[
    'c955be40-5b4f-4ff5-b1df-f3b70d66f903'::uuid,
    '95029403-b7bd-4696-a52b-f2386e5480d2'::uuid,
    '560cedb4-1010-4b5e-8559-78c665e95f44'::uuid
  ];
begin
  if (select count(*) from public.documents where id = any(remove_ids)) <> 3 then
    raise exception 'Relatórios v8 inesperados';
  end if;
  if (select count(*) from public.documents where doc_type = 'relatorio') <> 6 then
    raise exception 'Conjunto de relatórios inesperado antes da retenção v9';
  end if;

  insert into public.superseded_v8_conversion_report_archive_20260922(document)
  select to_jsonb(d) from public.documents d where d.id = any(remove_ids);

  if (select count(*) from public.superseded_v8_conversion_report_archive_20260922) <> 3 then
    raise exception 'Arquivamento v8 incompleto';
  end if;

  delete from public.documents where id = any(remove_ids);

  if (select count(*) from public.documents where doc_type = 'relatorio') <> 3 then
    raise exception 'Retenção v9 incorreta';
  end if;
end
$$;

commit;
