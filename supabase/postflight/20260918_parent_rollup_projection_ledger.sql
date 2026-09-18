-- Run only after postflight verification is clean. The schema change was
-- already applied in the transaction from its versioned migration file.
insert into supabase_migrations.schema_migrations (version, name, statements)
values (
  '20260918004358',
  'parent_rollup_projection_and_cascade_integrity',
  array[]::text[]
)
on conflict (version) do nothing;
