select max(version) as latest_ledger_version from supabase_migrations.schema_migrations;
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema='public' and table_name in ('tasks','task_links','task_activity_events')
 order by table_name, ordinal_position;
select table_name, column_name, data_type, udt_name, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='notifications'
   and column_name in ('profile_id','task_id','type','message')
 order by ordinal_position;
select c.conname, pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
 where c.conrelid='public.notifications'::regclass and c.contype in ('c','f')
 order by c.conname;
select count(*) filter (where status='revisao' and not requires_review) as review_without_flag,
       count(*) filter (where status='revisao' and reviewer_id is not null) as review_with_primary_reviewer
  from public.tasks;
