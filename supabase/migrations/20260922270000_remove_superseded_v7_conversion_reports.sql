-- Keep only the three delivered v8 PDFs; archive the superseded v7 metadata.

begin;

create table if not exists public.superseded_v7_conversion_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  remove_ids uuid[] := array[
    '7c373e78-b3aa-4ec1-afab-2fceebf5160a'::uuid,
    'e16a3f9e-3b35-498f-9468-c3e3d55b5d82'::uuid,
    '3c4be217-3469-44dd-be41-b196e18dc878'::uuid
  ];
begin
  if (select count(*) from public.documents where id=any(remove_ids))<>3 then raise exception 'Relatórios v7 inesperados'; end if;
  if (select count(*) from public.documents where doc_type='relatorio')<>6 then raise exception 'Conjunto inesperado antes da retenção v8'; end if;
  insert into public.superseded_v7_conversion_report_archive_20260922(document) select to_jsonb(d) from public.documents d where d.id=any(remove_ids);
  if (select count(*) from public.superseded_v7_conversion_report_archive_20260922)<>3 then raise exception 'Arquivamento v7 incompleto'; end if;
  delete from public.documents where id=any(remove_ids);
  if (select count(*) from public.documents where doc_type='relatorio')<>3 then raise exception 'Retenção v8 incorreta'; end if;
end
$$;

commit;
