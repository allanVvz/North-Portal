select jsonb_build_object(
  'document_columns', (
    select jsonb_agg(column_name order by column_name)
    from information_schema.columns
    where table_schema='public' and table_name='documents'
      and column_name in ('id','client_id','task_id','source_task_id','source_document_id','version_number','version_label','created_at')
  ),
  'existing_total', (select count(*) from public.documents),
  'currently_attributed', (select count(*) from public.documents where task_id is not null),
  'detached', (select count(*) from public.documents where task_id is null),
  'traffic_report_document_matches', (select count(distinct d.id) from public.documents d join public.traffic_reports tr on tr.document_id=d.id where d.task_id is null),
  'traffic_report_ambiguous', (select count(*) from (select document_id from public.traffic_reports where document_id is not null group by document_id having count(*) > 1) ambiguous),
  'traffic_report_version_groups', (select count(*) from (select task_id,period_to from public.traffic_reports where document_id is not null group by task_id,period_to having count(*) > 1) groups),
  'conversion_snapshot_document_matches', (select count(distinct d.id) from public.documents d join public.conversion_reports cr on cr.document_id=d.id join public.conversion_report_snapshots snapshot on snapshot.id=cr.interpretation_snapshot_id where d.task_id is null and snapshot.conversion_task_id is not null),
  'conversion_snapshot_missing_generator', (select count(*) from public.documents d join public.conversion_reports cr on cr.document_id=d.id left join public.conversion_report_snapshots snapshot on snapshot.id=cr.interpretation_snapshot_id where d.task_id is null and snapshot.conversion_task_id is null),
  'conversion_snapshot_version_groups', (select count(*) from (select snapshot.conversion_task_id,traffic.period_to from public.conversion_reports cr join public.conversion_report_snapshots snapshot on snapshot.id=cr.interpretation_snapshot_id join public.traffic_reports traffic on traffic.id=cr.traffic_report_id where cr.document_id is not null and snapshot.conversion_task_id is not null group by snapshot.conversion_task_id,traffic.period_to having count(*) > 1) groups),
  'existing_report_rows', (select count(*) from public.documents where doc_type='relatorio'),
  'ledger_latest', (select max(version) from supabase_migrations.schema_migrations)
);
