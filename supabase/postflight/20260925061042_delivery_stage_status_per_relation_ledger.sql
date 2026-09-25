-- Execute only after the postflight above proves equivalence.
begin;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260925061042', 'delivery_stage_status_per_relation', array[]::text[])
on conflict (version) do nothing;
commit;
