-- Final reconciliation of rows created before temporal recurrence pointers and
-- client-local task links became strict invariants.

do $$
declare
  cross_client_parent constant uuid := '1d6239fd-c535-5405-92ef-bfaf8a639821';
  cross_client_child constant uuid := '2432751a-1395-4e05-9224-bafbc7148bac';
begin
  -- A child occurrence has exactly two synchronized temporal pointers.  The
  -- only remaining incomplete rows have a valid payload parent but a null
  -- plan_id, which was written by the old recurrence writer.
  update public.tasks t
     set plan_id = (t.payload ->> 'recurrence_parent_id')::uuid
   where t.recurrence_cadence is null
     and t.plan_id is null
     and t.payload ? 'recurrence_parent_id'
     and t.payload ->> 'recurrence_parent_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (
       select 1 from public.tasks parent
       where parent.id = (t.payload ->> 'recurrence_parent_id')::uuid
     );

  -- Historical rows whose former template was deleted cannot retain a fake
  -- temporal parent.  They are completed standalone work now; preserve their
  -- content/history but discard the impossible relation and deferred flag.
  update public.tasks t
     set payload = t.payload - 'recurrence_parent_id' - 'deferred_until_accessed'
   where t.recurrence_cadence is null
     and t.plan_id is null
     and t.payload ? 'recurrence_parent_id'
     and (
       t.payload ->> 'recurrence_parent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (
         select 1 from public.tasks parent
         where parent.id = (t.payload ->> 'recurrence_parent_id')::uuid
       )
     );

  -- An execution may never retain the template cadence.  Its temporal parent
  -- is already unambiguous, so remove only those copied template fields.
  update public.tasks t
     set recurrence_cadence = null,
         recurrence_weekdays = '{}',
         recurrence_day_of_month = null,
         payload = t.payload - 'recurrence_group' - 'recurrence_revision'
   where t.recurrence_cadence is not null
     and coalesce(t.payload ->> 'recurrence_group', 'false') <> 'true'
     and t.plan_id is not null
     and t.payload ->> 'recurrence_parent_id' = t.plan_id::text;

  -- A historical meeting under another client cannot own, reference, or block
  -- a Baita card: all task links are deliberately client-local.  Removing the
  -- invalid edge preserves both cards and their independent histories.
  delete from public.task_links
   where parent_id = cross_client_parent
     and child_id = cross_client_child;

  if exists (
    select 1
    from public.task_links l
    join public.tasks parent on parent.id = l.parent_id
    join public.tasks child on child.id = l.child_id
    where parent.client_id is distinct from child.client_id
  ) then
    raise exception 'Cross-client task links remain after reconciliation';
  end if;

  if exists (
    select 1
    from public.tasks t
    where (t.plan_id is not null or t.payload ? 'recurrence_parent_id')
      and t.plan_id is distinct from case
        when t.payload ->> 'recurrence_parent_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (t.payload ->> 'recurrence_parent_id')::uuid
        else null
      end
  ) then
    raise exception 'Temporal recurrence pointers remain inconsistent';
  end if;

  if exists (
    select 1
    from public.tasks t
    join public.tasks parent on parent.id = t.plan_id
    where t.recurrence_cadence is not null
      and parent.recurrence_cadence is not null
  ) then
    raise exception 'Nested recurrence templates remain after reconciliation';
  end if;
end;
$$;
