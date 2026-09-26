-- Execute only after the catalog and function postflight proves equivalence.
begin;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260926020000', 'daily_piece_format_workflows', array[]::text[])
on conflict (version) do nothing;
commit;
