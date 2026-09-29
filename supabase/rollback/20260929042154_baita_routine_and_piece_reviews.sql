-- Emergency reversal of 20260929042154. Refuses to discard later reviews.
-- Historical before-images remain in migration_audit for inspection.
begin;

do $$
declare
  item record;
begin
  if (select count(*) from migration_audit.baita_routine_20260929 where entity='link') <> 8
    or (select count(*) from migration_audit.baita_routine_20260929 where entity='workspace') <> 9 then
    raise exception 'Baita rollback snapshot incomplete';
  end if;
  if exists (
    select 1 from public.task_links l join public.tasks p on p.id=l.parent_id
    where p.id in (select (before_row->>'parent_id')::uuid from migration_audit.baita_routine_20260929 where entity='link')
      and l.slot='publicacao' and l.relation_kind='workflow_step'
  ) then raise exception 'Publication already advanced; rollback needs manual reconciliation'; end if;

  -- Any review written after cutover belongs to the individual card and must
  -- be preserved by a manual rollback, never silently deleted.
  for item in select l.before_row->>'parent_id' as delivery_id,
      l.before_row->>'child_id' as old_edit_id,
      tl.child_id as new_edit_id
    from migration_audit.baita_routine_20260929 l
    join public.task_links tl on tl.parent_id=(l.before_row->>'parent_id')::uuid
      and tl.slot='edicao' and tl.relation_kind='workflow_step'
    where l.entity='link'
  loop
    if exists (select 1 from public.tasks t where t.id=item.new_edit_id::uuid
      and (t.completed_at is not null or
        coalesce(t.payload->'comments','[]'::jsonb) is distinct from coalesce((
          select jsonb_agg(c.value order by c.ord)
          from jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) with ordinality c(value,ord)
          where c.value->>'id' in
          ('1b78b1ca-3101-4868-ac46-dad5fccdf4da','bd3bb5c4-56bf-4b29-9756-8fb83a8eac8b',
           '9eaf64f2-92b8-4e28-868b-ed40dfff7de0','27711faf-af48-403d-9296-1a95271599e5',
           '070011e6-2162-4777-a49b-c81aab5561ea','7eae1b0c-a98d-47b4-a5ef-8c0fa997b4f7')
        ),'[]'::jsonb))) then
      raise exception 'Individual Editing has later work; rollback needs manual reconciliation';
    end if;
  end loop;

  drop trigger if exists tasks_validate_recurrence_client on public.tasks;
  drop trigger if exists notify_additional_task_reviewers on public.tasks;

  for item in select before_row from migration_audit.baita_routine_20260929 where entity='link' loop
    update public.task_links set child_id=(item.before_row->>'child_id')::uuid,
      status_override=(item.before_row->>'status_override')::public.task_status,
      completed_at_override=(item.before_row->>'completed_at_override')::timestamptz,
      paused_from_status=(item.before_row->>'paused_from_status')::public.task_status
    where parent_id=(item.before_row->>'parent_id')::uuid and slot='edicao' and relation_kind='workflow_step';
  end loop;
  for item in select before_row from migration_audit.baita_routine_20260929 where entity='workspace' loop
    update public.drive_creative_workspaces
      set stage_task_id=(item.before_row->>'stage_task_id')::uuid
    where creative_task_id=(item.before_row->>'creative_task_id')::uuid;
  end loop;
  delete from public.tasks where id in (
    'b6bf60aa-f1be-57c2-9d33-dd5555cc41d6','8ced65fb-c9c5-5c96-a3d4-83c71ec1f5e8',
    'a212ac2a-9276-5175-9f10-875666cca625','d75743aa-b0f4-5625-828b-a8fae1542092',
    'bc254f98-0813-52d7-bbcd-d80375ed8879','614b659a-0183-59e4-a060-3ef2139e58cd',
    'b3b56a9a-1fa2-517c-be17-592df5974d05','e0d2e2e7-31eb-55b7-aedf-6621b272fc99'
  );
  delete from public.task_links where parent_id='e5f32ccc-154a-4d11-b5dc-1098bec58fcc'
    and child_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and relation_kind='structural_member';
  for item in select entity_id,before_row from migration_audit.baita_routine_20260929 where entity='task' loop
    update public.tasks set payload=item.before_row->'payload',
      plan_id=(item.before_row->>'plan_id')::uuid
    where id=item.entity_id::uuid;
  end loop;
end $$;

drop function if exists public.validate_recurrence_client();
drop function if exists public.notify_additional_task_reviewers();
commit;
