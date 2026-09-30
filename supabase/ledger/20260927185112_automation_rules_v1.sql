begin;

do $$
declare
  fingerprint text;
  protected_count integer;
  rls_count integer;
begin
  select count(*), md5(coalesce(string_agg(id::text || ':' || automation_key || ':' || target_task_id::text || ':' || active::text || ':' || coalesce(md5(daily_config::text), ''), '|' order by id), ''))
    into protected_count, fingerprint from public.automation_configs;
  if protected_count <> 13 or fingerprint <> '1c204ffecd6088bb4843fe3cb27a4577' then
    raise exception 'Protected automation configs changed; review before ledger update';
  end if;
  if (select count(*) from public.automation_rules) <> 0
    or (select count(*) from public.automation_rule_versions) <> 0
    or (select count(*) from public.task_automation_bindings) <> 0
    or (select count(*) from public.automation_rule_events) <> 0
    or (select count(*) from public.daily_script_versions) <> 0 then
    raise exception 'New automation tables are not empty';
  end if;
  select count(*) into rls_count from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (
      'automation_rules', 'automation_rule_versions', 'task_automation_bindings',
      'automation_rule_events', 'daily_script_versions') and c.relrowsecurity;
  if rls_count <> 5 then raise exception 'RLS missing on a new table'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20260927185112') then
    raise exception 'Migration version already registered';
  end if;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20260927185112', 'automation_rules_v1', 'codex');

commit;
