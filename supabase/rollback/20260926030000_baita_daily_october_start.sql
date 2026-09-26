-- Reverse only while this setup remains inactive and unmaterialized.
begin;

do $$
declare
  mold_id constant uuid := '17df6360-1757-4afe-b9ef-96bbe368ae25';
  cycle_id constant uuid := '24c4dcd3-5b8a-5347-9106-89ce48391dd2';
  config_id constant uuid := 'cd387708-2aa5-4d2c-b2ac-dd22d33cd340';
  matched integer;
begin
  select count(*) into matched from public.automation_configs
   where id = config_id and active = false and jsonb_array_length(daily_config->'pieces') = 12
     and not exists (select 1 from jsonb_array_elements(daily_config->'pieces') p(value)
                     where p.value->>'offsetDays' <> '7');
  if matched <> 1 then raise exception 'BAITA daily configuration no longer safe to roll back'; end if;
  if not exists (select 1 from public.tasks where id = mold_id and start_date = date '2026-10-16')
     or not exists (select 1 from public.tasks where id = cycle_id and plan_id = mold_id
                    and payload->>'occurrence_date' = '2026-10-16')
     or exists (select 1 from public.task_links where parent_id in (mold_id, cycle_id))
     or exists (select 1 from public.drive_capture_workspaces where plan_task_id = cycle_id)
     or exists (select 1 from public.drive_creative_workspaces where plan_task_id = cycle_id) then
    raise exception 'BAITA daily cycle no longer safe to roll back';
  end if;

  update public.tasks set start_date = date '2026-11-16',
    due_date = date '2026-11-16', end_date = date '2026-11-16'
    where id = mold_id;
  update public.tasks set start_date = date '2026-11-16',
    due_date = date '2026-11-16',
    payload = jsonb_set(payload, '{occurrence_date}', '"2026-11-16"'::jsonb)
    where id = cycle_id;
  update public.automation_configs set daily_config = jsonb_set(daily_config,
    '{pieces}', (select jsonb_agg(p.value || '{"offsetDays":3}'::jsonb order by p.ord)
                 from jsonb_array_elements(daily_config->'pieces') with ordinality p(value, ord)))
    where id = config_id;
end;
$$;

commit;
