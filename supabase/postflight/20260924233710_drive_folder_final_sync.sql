begin read only;
select to_regprocedure('public.register_drive_folder_asset(uuid,text,text,text,bigint,text,text,timestamptz,uuid)') is not null as function_exists;
select has_function_privilege('service_role', 'public.register_drive_folder_asset(uuid,text,text,text,bigint,text,text,timestamptz,uuid)', 'EXECUTE') as service_can_execute;
select has_function_privilege('authenticated', 'public.register_drive_folder_asset(uuid,text,text,text,bigint,text,text,timestamptz,uuid)', 'EXECUTE') as user_can_execute;
select (select count(*) from public.drive_final_versions where state = 'current') as current_versions,
       (select count(*) from public.drive_final_versions) as all_versions;
rollback;
