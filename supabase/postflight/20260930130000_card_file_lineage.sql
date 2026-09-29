do $$
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='documents'
      and column_name in ('source_task_id','source_document_id','version_number','version_label')) <> 4 then
    raise exception 'Card file lineage columns are missing';
  end if;
  if exists (select 1 from public.documents where task_id is not null and source_task_id is distinct from task_id) then
    raise exception 'Existing reliable task attribution was not preserved';
  end if;
  if exists (select 1 from public.documents where source_task_id is not null and not exists (
      select 1 from public.tasks where tasks.id=documents.source_task_id)) then
    raise exception 'A source task reference is dangling';
  end if;
  if exists (select 1 from public.documents where source_document_id is not null and not exists (
      select 1 from public.documents source where source.id=documents.source_document_id
        and source.client_id=documents.client_id)) then
    raise exception 'A source document reference is missing or crosses clients';
  end if;
end $$;

select jsonb_build_object(
  'total', (select count(*) from public.documents),
  'with_task_id', (select count(*) from public.documents where task_id is not null),
  'with_source_task_id', (select count(*) from public.documents where source_task_id is not null),
  'with_source_document_id', (select count(*) from public.documents where source_document_id is not null),
  'traffic_reports_backfilled', (select count(*) from public.documents d join public.traffic_reports tr on tr.document_id=d.id where d.source_task_id=tr.task_id),
  'conversion_reports_backfilled', (select count(*) from public.documents d join public.conversion_reports cr on cr.document_id=d.id join public.conversion_report_snapshots snapshot on snapshot.id=cr.interpretation_snapshot_id where d.source_task_id=snapshot.conversion_task_id),
  'detached_unattributed', (select count(*) from public.documents where task_id is null and source_task_id is null),
  'ledger_latest', (select max(version) from supabase_migrations.schema_migrations)
);
