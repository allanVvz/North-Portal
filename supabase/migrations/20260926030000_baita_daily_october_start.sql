-- Correct the first BAITA daily cycle after the user selected October 16 and
-- a seven-day delivery deadline. Only the newly created, inactive setup is touched.
-- Rollback: supabase/rollback/20260926030000_baita_daily_october_start.sql
begin;

do $$
declare
  mold_id constant uuid := '17df6360-1757-4afe-b9ef-96bbe368ae25';
  cycle_id constant uuid := '24c4dcd3-5b8a-5347-9106-89ce48391dd2';
  config_id constant uuid := 'cd387708-2aa5-4d2c-b2ac-dd22d33cd340';
  baita_id constant uuid := '4f2bfda6-325d-4da3-94ff-c64802e1e2a4';
  matched integer;
begin
  select count(*) into matched from public.tasks
   where id = mold_id and client_id = baita_id and kind = 'plano_acao'
     and recurrence_cadence = 'mensal' and recurrence_day_of_month = 16
     and start_date = date '2026-11-16' and due_date = date '2026-11-16'
     and end_date = date '2026-11-16' and payload->>'recurrence_group' = 'true';
  if matched <> 1 then raise exception 'BAITA daily mold changed; aborting'; end if;

  select count(*) into matched from public.tasks
   where id = cycle_id and client_id = baita_id and kind = 'plano_acao'
     and plan_id = mold_id and start_date = date '2026-11-16'
     and due_date = date '2026-11-16' and payload->>'occurrence_date' = '2026-11-16'
     and not (payload ? 'daily_config_id');
  if matched <> 1 then raise exception 'BAITA first cycle changed; aborting'; end if;

  if exists (select 1 from public.task_links where parent_id in (mold_id, cycle_id))
     or exists (select 1 from public.drive_capture_workspaces where plan_task_id = cycle_id)
     or exists (select 1 from public.drive_creative_workspaces where plan_task_id = cycle_id) then
    raise exception 'BAITA daily cycle already has children or workspaces; aborting';
  end if;

  select count(*) into matched from public.automation_configs
   where id = config_id and automation_key = 'diaria_recorrente'
     and target_task_id = mold_id and active = false
     and daily_config->>'clientId' = baita_id::text
     and jsonb_array_length(daily_config->'pieces') = 12
     and not exists (select 1 from jsonb_array_elements(daily_config->'pieces') p(value)
                     where p.value->>'offsetDays' <> '3');
  if matched <> 1 then raise exception 'BAITA daily configuration changed; aborting'; end if;

  update public.tasks set start_date = date '2026-10-16',
    due_date = date '2026-10-16', end_date = date '2026-10-16'
    where id = mold_id;
  update public.tasks set start_date = date '2026-10-16',
    due_date = date '2026-10-16',
    payload = jsonb_set(payload, '{occurrence_date}', '"2026-10-16"'::jsonb)
    where id = cycle_id;
  update public.automation_configs set daily_config = jsonb_set(daily_config,
    '{pieces}', (select jsonb_agg(p.value || '{"offsetDays":7}'::jsonb order by p.ord)
                 from jsonb_array_elements(daily_config->'pieces') with ordinality p(value, ord)))
    where id = config_id;
end;
$$;

commit;
