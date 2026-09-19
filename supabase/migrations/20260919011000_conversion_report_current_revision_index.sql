-- A report may be deliberately regenerated from the same final evidence (for
-- example, a template/narrative cutover).  Keep one current version per source
-- fingerprint while allowing the prior, auditable version to be superseded.

begin;

drop index if exists public.conversion_reports_context_idempotency_idx;
create unique index conversion_reports_current_idempotency_idx
  on public.conversion_reports (feedback_task_id, traffic_report_id, source_fingerprint)
  where status <> 'superseded';

commit;
