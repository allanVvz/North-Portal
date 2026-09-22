-- Retain only the three v6 artifacts after their successful generation.

begin;

create table if not exists public.superseded_v5_conversion_report_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  document jsonb not null
);

do $$
declare
  remove_ids uuid[] := array[
    '998230a7-4344-4987-95f2-81e946bd534f'::uuid,
    'c64562d8-ca32-4a0b-85ae-43d675aad7c7'::uuid,
    'dc5091d3-ccdb-4faf-bd73-0b2f76f984a8'::uuid
  ];
begin
  if (select count(*) from public.documents where id = any(remove_ids)) <> 3 then raise exception 'Relatórios v5 inesperados'; end if;
  if (select count(*) from public.documents where doc_type='relatorio') <> 6 then raise exception 'Conjunto de relatórios inesperado antes da retenção v6'; end if;
  insert into public.superseded_v5_conversion_report_archive_20260922(document) select to_jsonb(d) from public.documents d where d.id = any(remove_ids);
  if (select count(*) from public.superseded_v5_conversion_report_archive_20260922) <> 3 then raise exception 'Arquivamento v5 incompleto'; end if;
  delete from public.documents where id = any(remove_ids);
  if (select count(*) from public.documents where doc_type='relatorio') <> 3 then raise exception 'Retenção v6 incorreta'; end if;
end
$$;

commit;
