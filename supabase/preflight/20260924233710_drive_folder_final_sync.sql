begin read only;
select 'schema' as check_name, count(*) as value
from information_schema.columns
where table_schema = 'public' and table_name in ('drive_assets', 'drive_final_versions', 'drive_creative_workspaces');
select 'workspaces' as check_name, count(*) as value from public.drive_creative_workspaces;
select 'final_assets' as check_name, count(*) as value from public.drive_assets where role = 'final';
select 'final_versions' as check_name, count(*) as value from public.drive_final_versions;
select 'invalid_current_versions' as check_name, count(*) as value
from public.drive_final_versions v join public.drive_assets a on a.id = v.asset_id
where v.state = 'current' and (a.role <> 'final' or a.state <> 'active');
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
rollback;
