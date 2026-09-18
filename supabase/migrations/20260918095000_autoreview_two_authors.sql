begin;

-- Preserve each former flag so this data correction can be rolled back.
create table if not exists public.autoreview_backfill_archive_20260918 (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  requires_review boolean not null,
  archived_at timestamptz not null default now()
);

insert into public.autoreview_backfill_archive_20260918(task_id, requires_review)
select t.id, t.requires_review
from public.tasks t
where t.reviewer_id is not null
  and t.requires_review
  and exists (
    select 1 from public.task_assignees ta
    where ta.task_id = t.id and ta.profile_id = t.reviewer_id
  )
on conflict (task_id) do nothing;

-- Generic rule: when the reviewer is one of the (up to two) structured
-- authors, independent review is impossible and the card auto-reviews.
update public.tasks t
set requires_review = false
where t.reviewer_id is not null
  and t.requires_review
  and exists (
    select 1 from public.task_assignees ta
    where ta.task_id = t.id and ta.profile_id = t.reviewer_id
  );

commit;
