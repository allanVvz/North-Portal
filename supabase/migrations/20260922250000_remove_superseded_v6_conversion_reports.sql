-- Retain only the three corrected v7 PDFs after their successful delivery.

begin;

create table if not exists public.superseded_v6_conversion_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  remove_ids uuid[] := array[
    '2a00213f-aeca-45a0-99ab-1afe68c9a419'::uuid,
    'b87a9dc2-85ab-48f0-8a5e-4ab97590faf2'::uuid,
    '55c5b31c-2f42-4bef-8d8e-cb8b044dae71'::uuid
  ];
begin
  if (select count(*) from public.documents where id = any(remove_ids)) <> 3 then raise exception 'Relatórios v6 inesperados'; end if;
  if (select count(*) from public.documents where doc_type='relatorio') <> 6 then raise exception 'Conjunto de relatórios inesperado antes da retenção v7'; end if;
  insert into public.superseded_v6_conversion_report_archive_20260922(document) select to_jsonb(d) from public.documents d where d.id = any(remove_ids);
  if (select count(*) from public.superseded_v6_conversion_report_archive_20260922) <> 3 then raise exception 'Arquivamento v6 incompleto'; end if;
  delete from public.documents where id = any(remove_ids);
  if (select count(*) from public.documents where doc_type='relatorio') <> 3 then raise exception 'Retenção v7 incorreta'; end if;
end
$$;

commit;
