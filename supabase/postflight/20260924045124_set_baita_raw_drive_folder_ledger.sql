-- Execute somente após o postflight de equivalência e valor da linha BAITA.
begin;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260924045124', 'set_baita_raw_drive_folder', array[]::text[])
on conflict (version) do nothing;
commit;
