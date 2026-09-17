-- `plan_id` is now exclusively the temporal pointer from a recurrence
-- execution to its template.  Older data used it for plan membership, while
-- an old explicit-date demo accidentally kept recurrence configuration on an
-- execution.  Reconcile the two proven cases without deleting cards or
-- inventing a structural owner.

do $$
declare
  meme_template constant uuid := 'a0950f53-6d08-5844-a9ba-33eba4888158';
  august_plan constant uuid := 'ca49e7b5-ac1b-458e-bcad-d9ad442525e4';
  missing_legacy_parent constant uuid := 'bf1b8e6f-5219-48f3-9a11-6317ba965e7c';
  demo_template constant uuid := 'bfe8e21f-1ad7-4114-889a-842dd807150f';
  demo_execution constant uuid := 'fe6100fd-667b-5574-ad1f-636b9ff9bb57';
begin
  -- The Meme card is a live recurrence template.  Its former plan membership
  -- cannot remain in plan_id (it makes the template look like an execution),
  -- and its payload points at a deleted parent.  Preserve the historical plan
  -- context as a non-rollup reference instead of silently losing it.
  if exists (
    select 1
    from public.tasks t
    where t.id = meme_template
      and (
        t.recurrence_cadence is null
        or coalesce(t.payload ->> 'recurrence_group', 'false') <> 'true'
        or t.plan_id is distinct from august_plan
        or t.payload ->> 'recurrence_parent_id' <> missing_legacy_parent::text
      )
  ) and not exists (
    select 1
    from public.tasks t
    where t.id = meme_template
      and t.recurrence_cadence is not null
      and coalesce(t.payload ->> 'recurrence_group', 'false') = 'true'
      and t.plan_id is null
      and t.payload ->> 'recurrence_parent_id' is null
  ) then
    raise exception 'Reviewed Meme recurrence template is not in the expected legacy state';
  end if;

  insert into public.task_links (parent_id, child_id, relation_kind, slot, position)
  values (august_plan, meme_template, 'reference', null, 0)
  on conflict (parent_id, child_id) do update
    set relation_kind = excluded.relation_kind,
        slot = excluded.slot,
        position = excluded.position;

  update public.tasks
     set plan_id = null,
         payload = payload - 'recurrence_parent_id'
   where id = meme_template
     and recurrence_cadence is not null
     and coalesce(payload ->> 'recurrence_group', 'false') = 'true';

  -- This clientless production demo is an execution of demo_template, not a
  -- second nested recurrence template.  Keep its temporal parent and its
  -- explicit-date grouping; remove only template-only recurrence fields.
  if exists (
    select 1
    from public.tasks child
    where child.id = demo_execution
      and (
        child.plan_id is distinct from demo_template
        or child.payload ->> 'recurrence_parent_id' <> demo_template::text
      )
  ) then
    raise exception 'Reviewed recurrence demo execution is not linked to its template';
  end if;

  update public.tasks
     set recurrence_cadence = null,
         recurrence_weekdays = '{}',
         recurrence_day_of_month = null,
         payload = payload - 'recurrence_group' - 'recurrence_revision'
   where id = demo_execution
     and plan_id = demo_template
     and payload ->> 'recurrence_parent_id' = demo_template::text;

  if exists (
    select 1
    from public.tasks t
    where t.recurrence_cadence is not null
      and coalesce(t.payload ->> 'recurrence_group', 'false') = 'true'
      and t.plan_id is not null
      and exists (
        select 1 from public.tasks parent
        where parent.id = t.plan_id
          and parent.recurrence_cadence is not null
          and coalesce(parent.payload ->> 'recurrence_group', 'false') = 'true'
      )
  ) then
    raise exception 'Nested recurrence templates remain after reconciliation';
  end if;
end;
$$;
