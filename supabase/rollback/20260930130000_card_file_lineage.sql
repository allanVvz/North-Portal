begin;

-- Preserve lineage values before removing the added columns. This archive is
-- intentionally retained after schema rollback so regenerated files do not
-- lose their recovered report attribution or source-version references.
create table if not exists public.document_file_lineage_rollback_archive (
  archived_at timestamptz not null default now(),
  document_id uuid not null,
  source_task_id uuid,
  source_document_id uuid,
  version_number integer,
  version_label text
);
insert into public.document_file_lineage_rollback_archive(document_id,source_task_id,source_document_id,version_number,version_label)
select id,source_task_id,source_document_id,version_number,version_label
from public.documents
where source_task_id is not null or source_document_id is not null or version_number is not null or version_label is not null;

drop index if exists public.documents_source_document_idx;
drop index if exists public.documents_source_task_idx;
-- Keep the archive restricted to privileged server/database access.
alter table public.document_file_lineage_rollback_archive enable row level security;
alter table public.documents
  drop column if exists version_number,
  drop column if exists version_label,
  drop column if exists source_document_id,
  drop column if exists source_task_id;

commit;
