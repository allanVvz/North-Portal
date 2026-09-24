-- Execute only after confirming the function and privileges in postflight.
begin;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260924233710', 'drive_folder_final_sync', array[]::text[])
on conflict (version) do nothing;
commit;
