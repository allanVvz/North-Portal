begin;

-- Keep legacy `task_id` compatible while recording the structured source card
-- and prior document version for every newly generated file.
alter table public.documents
  add column source_task_id uuid references public.tasks(id) on delete set null,
  add column source_document_id uuid references public.documents(id) on delete set null,
  add column version_number integer check (version_number is null or version_number > 0),
  add column version_label text;

create index documents_source_task_idx on public.documents(source_task_id, created_at, id)
  where source_task_id is not null;
create index documents_source_document_idx on public.documents(source_document_id)
  where source_document_id is not null;

-- Existing rows with `task_id` already have reliable card attribution. Rows
-- without it are intentionally left detached: a URL in free text is not enough
-- evidence to assign a document to a card.
update public.documents set source_task_id = task_id
where task_id is not null and source_task_id is null;

-- Generated report records retain structured document references even when
-- regeneration intentionally clears documents.task_id. Restore provenance
-- only when the entity reference is one-to-one and its generator task is known.
update public.documents d
set source_task_id = tr.task_id,
    version_number = tr.revision
from public.traffic_reports tr
where tr.document_id = d.id
  and d.source_task_id is null
  and d.task_id is null
  and tr.task_id is not null
  and (select count(*) from public.traffic_reports other where other.document_id = d.id) = 1;

update public.documents d
set source_task_id = snapshot.conversion_task_id,
    version_label = cr.source_fingerprint
from public.conversion_reports cr
join public.conversion_report_snapshots snapshot on snapshot.id = cr.interpretation_snapshot_id
where cr.document_id = d.id
  and d.source_task_id is null
  and d.task_id is null
  and snapshot.conversion_task_id is not null
  and (select count(*) from public.conversion_reports other where other.document_id = d.id) = 1;

-- Where multiple generated versions are tied to the same structured report
-- source and period, point every later PDF directly at its original version.
update public.documents d
set source_document_id = first_version.document_id
from public.traffic_reports tr
join lateral (
  select other.document_id
  from public.traffic_reports other
  where other.task_id = tr.task_id and other.period_to = tr.period_to and other.document_id is not null
  order by other.revision, other.generated_at, other.id
  limit 1
) first_version on true
where tr.document_id = d.id
  and d.source_task_id = tr.task_id
  and tr.document_id is distinct from first_version.document_id
  and (select count(*) from public.traffic_reports matches where matches.document_id = d.id) = 1;

update public.documents d
set source_document_id = first_version.document_id
from public.conversion_reports cr
join public.conversion_report_snapshots snapshot on snapshot.id = cr.interpretation_snapshot_id
join public.traffic_reports tr on tr.id = cr.traffic_report_id
join lateral (
  select other.document_id
  from public.conversion_reports other
  join public.conversion_report_snapshots other_snapshot on other_snapshot.id = other.interpretation_snapshot_id
  join public.traffic_reports other_traffic on other_traffic.id = other.traffic_report_id
  where other_snapshot.conversion_task_id = snapshot.conversion_task_id
    and other_snapshot.conversion_task_id is not null
    and other.document_id is not null
    and other_traffic.period_to = tr.period_to
  order by other.generated_at, other.id
  limit 1
) first_version on true
where cr.document_id = d.id
  and d.source_task_id = snapshot.conversion_task_id
  and cr.document_id is distinct from first_version.document_id
  and (select count(*) from public.conversion_reports matches where matches.document_id = d.id) = 1;

commit;
