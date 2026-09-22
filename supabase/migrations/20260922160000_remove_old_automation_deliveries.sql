-- User-authorized cleanup: retain only the three current automation deliveries.
-- Recurrence molds/configs remain so future operations stay configured.

begin;

create table if not exists public.automation_delivery_deletion_archive_20260922 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  occurrence jsonb not null,
  steps jsonb not null,
  snapshots jsonb not null
);

do $$
declare
  keep_ids uuid[] := array[
    'b805b260-c8d6-5f22-9d2a-6437ae30263e'::uuid,
    'b27d8131-2347-525d-a79a-dd0c334138ea'::uuid,
    '62593d51-e48e-52fa-a63a-7ff492bf5927'::uuid
  ];
  occ_ids uuid[];
  step_ids uuid[];
  occ_count integer;
begin
  select array_agg(id), count(*) into occ_ids, occ_count
  from public.tasks
  where kind = 'automacao'
    and payload ? 'recurrence_parent_id'
    and id <> all(keep_ids);
  if occ_count <> 5 then
    raise exception 'Esperava 5 Entregas antigas de automação, encontrei %', occ_count;
  end if;

  select coalesce(array_agg(child_id), '{}'::uuid[]) into step_ids
  from public.task_links
  where parent_id = any(occ_ids) and relation_kind = 'workflow_step';

  insert into public.automation_delivery_deletion_archive_20260922(occurrence, steps, snapshots)
  select
    to_jsonb(occ),
    coalesce((select jsonb_agg(to_jsonb(step)) from public.tasks step where step.id = any(
      select child_id from public.task_links where parent_id = occ.id and relation_kind = 'workflow_step'
    )), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(snapshot)) from public.conversion_report_snapshots snapshot
      where snapshot.feedback_task_id = any(step_ids) or snapshot.conversion_task_id = any(step_ids)), '[]'::jsonb)
  from public.tasks occ where occ.id = any(occ_ids);

  if (select count(*) from public.automation_delivery_deletion_archive_20260922) <> 5 then
    raise exception 'Arquivamento incompleto das Entregas antigas';
  end if;

  -- Explicitly authorized removal of the append-only audit snapshots tied only
  -- to the deliveries being deleted. The trigger state is transactional.
  alter table public.conversion_report_snapshots disable trigger conversion_report_snapshots_immutable;
  delete from public.conversion_report_snapshots
  where feedback_task_id = any(step_ids) or conversion_task_id = any(step_ids);
  alter table public.conversion_report_snapshots enable trigger conversion_report_snapshots_immutable;

  -- Delete parent first so the Delivery consistency trigger cannot observe a
  -- parent temporarily missing its first workflow step; then remove children.
  delete from public.tasks where id = any(occ_ids);
  delete from public.tasks where id = any(step_ids);

  if exists (select 1 from public.tasks where id = any(occ_ids) or id = any(step_ids)) then
    raise exception 'Sobrou uma Entrega ou etapa antiga após a limpeza';
  end if;
end
$$;

commit;
