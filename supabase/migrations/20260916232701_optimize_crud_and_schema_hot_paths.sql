-- Query and integrity hardening for the current CRUD model.
--
-- This migration deliberately keeps the public API unchanged. The new
-- indexes match the filters/order used by lib/supabase.ts, constraints are
-- NOT VALID so legacy drift does not block deploys (new writes are still
-- checked), and hot RLS helpers use InitPlans instead of running per row.

-- ---- Tasks / task graph hot paths ------------------------------------------

create index if not exists tasks_client_board_order_idx
  on public.tasks (client_id, position, created_at, id);

create index if not exists tasks_unassigned_board_order_idx
  on public.tasks (position, created_at, id)
  where client_id is null;

create index if not exists tasks_kind_updated_idx
  on public.tasks (kind, updated_at desc, id);

create index if not exists tasks_flow_parent_updated_idx
  on public.tasks (updated_at desc, id)
  where payload ->> 'flow_parent' = 'true';

create index if not exists task_links_parent_position_idx
  on public.task_links (parent_id, position, child_id);

-- A delivery has at most one child in each named slot. Plan membership uses a
-- null slot and is intentionally unaffected. This closes the SELECT-then-
-- INSERT race in the relations route.
create unique index if not exists task_links_parent_slot_unique_idx
  on public.task_links (parent_id, slot)
  where slot is not null;

-- FK indexes are not created automatically by Postgres. Besides joins, these
-- indexes keep ON DELETE CASCADE/SET NULL from scanning whole child tables.
create index if not exists traffic_reports_task_id_idx
  on public.traffic_reports (task_id);
create index if not exists traffic_reports_document_id_idx
  on public.traffic_reports (document_id) where document_id is not null;
create index if not exists conversion_reports_traffic_report_id_idx
  on public.conversion_reports (traffic_report_id);
create index if not exists conversion_reports_document_id_idx
  on public.conversion_reports (document_id) where document_id is not null;
create index if not exists automation_configs_created_by_idx
  on public.automation_configs (created_by) where created_by is not null;
create index if not exists automation_configs_depends_on_idx
  on public.automation_configs (depends_on_config_id)
  where depends_on_config_id is not null;
create index if not exists responsibility_assignments_profile_idx
  on public.responsibility_assignments (profile_id);
create index if not exists integration_credentials_client_id_idx
  on public.integration_credentials (client_id) where client_id is not null;
create index if not exists integration_credentials_connected_by_idx
  on public.integration_credentials (connected_by) where connected_by is not null;

-- Keep the task graph inside one tenant and acyclic. This protects all write
-- paths, including service code and SQL, rather than relying on a route-level
-- preflight that can race with another request. Existing rows are not scanned
-- when the trigger is created; the audit reports legacy violations separately.
create or replace function public.validate_task_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_client_id uuid;
  child_client_id uuid;
begin
  select t.client_id into parent_client_id
    from public.tasks t where t.id = new.parent_id;
  if not found then
    raise exception 'Parent task % does not exist', new.parent_id
      using errcode = '23503';
  end if;

  select t.client_id into child_client_id
    from public.tasks t where t.id = new.child_id;
  if not found then
    raise exception 'Child task % does not exist', new.child_id
      using errcode = '23503';
  end if;

  if parent_client_id is distinct from child_client_id then
    raise exception 'Linked tasks must belong to the same client'
      using errcode = '23514';
  end if;

  -- The recursive read below uses the transaction snapshot.  Serialize graph
  -- mutations so two concurrent inserts cannot each miss the other's edge and
  -- form a cycle (for example A -> B and B -> A). Graph writes are rare, and
  -- one small transaction-scoped lock is safer than a per-edge lock, which
  -- would still miss cycles made from three different edges.
  perform pg_advisory_xact_lock(hashtextextended('public.task_links.graph', 0));

  if exists (
    with recursive descendants(id) as (
      select l.child_id
      from public.task_links l
      where l.parent_id = new.child_id
      union
      select l.child_id
      from public.task_links l
      join descendants d on l.parent_id = d.id
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'Task link would create a cycle'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_link on public.task_links;
create trigger validate_task_link
  before insert or update of parent_id, child_id on public.task_links
  for each row execute function public.validate_task_link();

-- A link is also invalidated if someone later moves just one of its tasks to
-- another client. Check that less common write path as well, rather than
-- letting the INSERT/UPDATE trigger be the only guardian of the invariant.
create or replace function public.validate_task_client_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is not distinct from old.client_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('public.task_links.graph', 0));

  if exists (
    select 1
    from public.task_links l
    join public.tasks counterpart
      on counterpart.id = case
        when l.parent_id = old.id then l.child_id
        else l.parent_id
      end
    where (l.parent_id = old.id or l.child_id = old.id)
      and counterpart.client_id is distinct from new.client_id
  ) then
    raise exception 'A linked task cannot be moved to another client'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_client_reassignment on public.tasks;
create trigger validate_task_client_reassignment
  before update of client_id on public.tasks
  for each row execute function public.validate_task_client_reassignment();

-- ---- Temporal/data-shape constraints --------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_date_window_valid'
  ) then
    alter table public.tasks
      add constraint tasks_date_window_valid
      check (start_date is null or end_date is null or start_date <= end_date)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_schedule_window_valid'
  ) then
    alter table public.tasks
      add constraint tasks_schedule_window_valid
      check (
        scheduled_start_at is null
        or scheduled_end_at is null
        or scheduled_start_at <= scheduled_end_at
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.task_metrics'::regclass
      and conname = 'task_metrics_period_valid'
  ) then
    alter table public.task_metrics
      add constraint task_metrics_period_valid
      check (
        (period_from is null and period_to is null)
        or (period_from is not null and period_to is not null and period_from <= period_to)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meta_insights_cache'::regclass
      and conname = 'meta_insights_cache_window_valid'
  ) then
    alter table public.meta_insights_cache
      add constraint meta_insights_cache_window_valid
      check (date_from <= date_to) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meta_insights_cache'::regclass
      and conname = 'meta_insights_cache_payload_array'
  ) then
    alter table public.meta_insights_cache
      add constraint meta_insights_cache_payload_array
      check (jsonb_typeof(payload) = 'array') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.traffic_reports'::regclass
      and conname = 'traffic_reports_period_valid'
  ) then
    alter table public.traffic_reports
      add constraint traffic_reports_period_valid
      check (period_from <= period_to) not valid;
  end if;
end $$;

create index if not exists meta_insights_cache_window_idx
  on public.meta_insights_cache
  (client_id, datasource, date_from, date_to, fetched_at desc);

-- task_metrics duplicates the task's client_id for the dominant temporal
-- lookup. Enforce that denormalized value on every new/changed row so RLS can
-- never be bypassed with a forged client_id.
create or replace function public.validate_task_metrics_client()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner_client_id uuid;
begin
  select t.client_id
    into owner_client_id
    from public.tasks t
   where t.id = new.task_id;

  if not found then
    raise exception 'Task % does not exist', new.task_id
      using errcode = '23503';
  end if;

  if owner_client_id is distinct from new.client_id then
    raise exception 'task_metrics.client_id must match tasks.client_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_metrics_client on public.task_metrics;
create trigger validate_task_metrics_client
  before insert or update of task_id, client_id on public.task_metrics
  for each row execute function public.validate_task_metrics_client();

-- ---- RLS hot paths ----------------------------------------------------------

drop policy if exists "task_metrics admin all" on public.task_metrics;
drop policy if exists "task_metrics client read own" on public.task_metrics;
drop policy if exists "task_metrics client collect insert" on public.task_metrics;
drop policy if exists "task_metrics client collect update" on public.task_metrics;

create policy "task_metrics select" on public.task_metrics
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1
      from public.tasks t
      where t.id = task_metrics.task_id
        and t.client_id = (select public.current_client_id())
    )
  );

create policy "task_metrics insert" on public.task_metrics
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (
      exists (
        select 1
        from public.tasks t
        where t.id = task_metrics.task_id
          and t.client_id = (select public.current_client_id())
      )
      and exists (
        select 1
        from public.automation_configs ac
        where ac.target_task_id = task_metrics.task_id
          and ac.automation_key = 'coleta_metrica_cliente'
          and ac.active
      )
    )
  );

create policy "task_metrics update" on public.task_metrics
  for update to authenticated
  using (
    (select public.is_admin())
    or (
      exists (
        select 1
        from public.tasks t
        where t.id = task_metrics.task_id
          and t.client_id = (select public.current_client_id())
      )
      and exists (
        select 1
        from public.automation_configs ac
        where ac.target_task_id = task_metrics.task_id
          and ac.automation_key = 'coleta_metrica_cliente'
          and ac.active
      )
    )
  )
  with check (
    (select public.is_admin())
    or (
      exists (
        select 1
        from public.tasks t
        where t.id = task_metrics.task_id
          and t.client_id = (select public.current_client_id())
      )
      and exists (
        select 1
        from public.automation_configs ac
        where ac.target_task_id = task_metrics.task_id
          and ac.automation_key = 'coleta_metrica_cliente'
          and ac.active
      )
    )
  );

create policy "task_metrics delete" on public.task_metrics
  for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "meta_insights_cache admin all" on public.meta_insights_cache;
drop policy if exists "meta_insights_cache client read own" on public.meta_insights_cache;

create policy "meta_insights_cache select" on public.meta_insights_cache
  for select to authenticated
  using (
    (select public.is_admin())
    or client_id = (select public.current_client_id())
  );
create policy "meta_insights_cache insert" on public.meta_insights_cache
  for insert to authenticated with check ((select public.is_admin()));
create policy "meta_insights_cache update" on public.meta_insights_cache
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "meta_insights_cache delete" on public.meta_insights_cache
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "traffic reports admin all" on public.traffic_reports;
create policy "traffic reports admin all" on public.traffic_reports
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "conversion reports admin all" on public.conversion_reports;
create policy "conversion reports admin all" on public.conversion_reports
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- The live advisor reports all four template policies and both lead policies
-- evaluating auth helpers per row. Preserve their access model, but make the
-- stable auth values InitPlans.
drop policy if exists "performance templates read" on public.performance_templates;
drop policy if exists "performance templates create" on public.performance_templates;
drop policy if exists "performance templates update" on public.performance_templates;
drop policy if exists "performance templates delete" on public.performance_templates;

create policy "performance templates read" on public.performance_templates
  for select to authenticated
  using (
    (select public.is_admin())
    and (scope = 'agency' or owner_profile_id = (select auth.uid()))
  );
create policy "performance templates create" on public.performance_templates
  for insert to authenticated
  with check (
    (select public.is_admin())
    and (
      (scope = 'personal' and owner_profile_id = (select auth.uid()))
      or (scope = 'agency' and owner_profile_id is null and (select public.is_manager()))
    )
  );
create policy "performance templates update" on public.performance_templates
  for update to authenticated
  using (
    (select public.is_admin())
    and (
      (scope = 'personal' and owner_profile_id = (select auth.uid()))
      or (scope = 'agency' and (select public.is_manager()))
    )
  )
  with check (
    (select public.is_admin())
    and (
      (scope = 'personal' and owner_profile_id = (select auth.uid()))
      or (scope = 'agency' and owner_profile_id is null and (select public.is_manager()))
    )
  );
create policy "performance templates delete" on public.performance_templates
  for delete to authenticated
  using (
    (select public.is_admin())
    and (
      (scope = 'personal' and owner_profile_id = (select auth.uid()))
      or (scope = 'agency' and (select public.is_manager()))
    )
  );

drop policy if exists "admins can read leads" on public.leads;
drop policy if exists "admins can update leads" on public.leads;
create policy "admins can read leads" on public.leads
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins can update leads" on public.leads
  for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- Collapse admin + client SELECT policies on the two graph tables so each row
-- evaluates one policy, not two permissive policies.
drop policy if exists "task_assignees admin all" on public.task_assignees;
drop policy if exists "task_assignees client read visible" on public.task_assignees;
create policy "task_assignees select" on public.task_assignees
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.tasks t
      where t.id = task_assignees.task_id
        and t.client_id = (select public.current_client_id())
        and (t.client_visible = true or t.status in ('aprovacao', 'aprovado'))
    )
  );
create policy "task_assignees insert" on public.task_assignees
  for insert to authenticated with check ((select public.is_admin()));
create policy "task_assignees update" on public.task_assignees
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "task_assignees delete" on public.task_assignees
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "task links admin all" on public.task_links;
drop policy if exists "task links client read" on public.task_links;
create policy "task links select" on public.task_links
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.tasks t
      where t.id = task_links.parent_id
        and t.client_visible
        and t.client_id = (select public.current_client_id())
    )
  );
create policy "task links insert" on public.task_links
  for insert to authenticated with check ((select public.is_admin()));
create policy "task links update" on public.task_links
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "task links delete" on public.task_links
  for delete to authenticated using ((select public.is_admin()));
