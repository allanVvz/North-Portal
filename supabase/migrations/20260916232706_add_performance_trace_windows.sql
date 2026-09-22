-- Windowed, append-only storage for Performance traces.
--
-- meta_insights_cache remains in place as a compatibility fallback while the
-- ingestion/API are cut over. These tables make time a first-class indexed
-- dimension, preserve raw observations for zoom, and persist reduced traces
-- for wide windows without reading a 90-day JSONB blob.

create table if not exists public.performance_trace_points (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete cascade,
  account_id text not null,
  datasource text not null,
  entity_level text not null
    check (entity_level in ('account', 'campaign', 'adset', 'ad', 'post')),
  entity_id text not null,
  platform text not null default 'unknown',
  metric_key text not null,
  observed_at timestamptz not null,
  value numeric not null,
  source_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  dimensions jsonb not null default '{}'::jsonb,
  constraint performance_trace_points_dimensions_object
    check (jsonb_typeof(dimensions) = 'object'),
  unique (
    datasource, account_id, entity_level, entity_id,
    platform, metric_key, observed_at
  )
);

create index if not exists performance_trace_points_client_window_idx
  on public.performance_trace_points
  (client_id, metric_key, observed_at, id);
create index if not exists performance_trace_points_series_window_idx
  on public.performance_trace_points
  (account_id, datasource, entity_level, entity_id, platform, metric_key, observed_at, id);

comment on table public.performance_trace_points is
  'Raw observed metric points. Never replace these with interpolated values; zoom/detail reads this table.';

create table if not exists public.performance_trace_rollups (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete cascade,
  account_id text not null,
  datasource text not null,
  entity_level text not null
    check (entity_level in ('account', 'campaign', 'adset', 'ad', 'post')),
  entity_id text not null,
  platform text not null default 'unknown',
  metric_key text not null,
  bucket_seconds integer not null check (bucket_seconds > 0),
  bucket_start timestamptz not null,
  first_at timestamptz not null,
  first_value numeric not null,
  min_at timestamptz not null,
  min_value numeric not null,
  max_at timestamptz not null,
  max_value numeric not null,
  last_at timestamptz not null,
  last_value numeric not null,
  sample_count integer not null check (sample_count > 0),
  computed_at timestamptz not null default now(),
  constraint performance_trace_rollups_bounds_valid check (
    bucket_start <= first_at
    and bucket_start <= min_at
    and bucket_start <= max_at
    and bucket_start <= last_at
    and first_at < bucket_start + bucket_seconds * interval '1 second'
    and min_at < bucket_start + bucket_seconds * interval '1 second'
    and max_at < bucket_start + bucket_seconds * interval '1 second'
    and last_at < bucket_start + bucket_seconds * interval '1 second'
    and first_at <= last_at
  ),
  unique (
    datasource, account_id, entity_level, entity_id, platform,
    metric_key, bucket_seconds, bucket_start
  )
);

create index if not exists performance_trace_rollups_client_window_idx
  on public.performance_trace_rollups
  (client_id, metric_key, bucket_seconds, bucket_start);
create index if not exists performance_trace_rollups_series_window_idx
  on public.performance_trace_rollups
  (account_id, datasource, entity_level, entity_id, platform,
   metric_key, bucket_seconds, bucket_start);

comment on table public.performance_trace_rollups is
  'Persisted LOD envelope. first/min/max/last preserve peaks and trace shape in wide windows.';

create table if not exists public.performance_trace_stationary_windows (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete cascade,
  account_id text not null,
  datasource text not null,
  entity_level text not null
    check (entity_level in ('account', 'campaign', 'adset', 'ad', 'post')),
  entity_id text not null,
  platform text not null default 'unknown',
  metric_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  sample_count integer not null check (sample_count >= 2),
  min_value numeric not null,
  max_value numeric not null,
  max_delta numeric not null check (max_delta >= 0),
  absolute_epsilon numeric not null check (absolute_epsilon >= 0),
  relative_epsilon numeric not null check (relative_epsilon >= 0),
  computed_at timestamptz not null default now(),
  constraint performance_trace_stationary_window_valid
    check (starts_at < ends_at and min_value <= max_value),
  unique (
    datasource, account_id, entity_level, entity_id, platform,
    metric_key, starts_at, ends_at
  )
);

create index if not exists performance_trace_stationary_client_window_idx
  on public.performance_trace_stationary_windows
  (client_id, metric_key, starts_at, ends_at);
create index if not exists performance_trace_stationary_series_window_idx
  on public.performance_trace_stationary_windows
  (account_id, datasource, entity_level, entity_id, platform,
   metric_key, starts_at, ends_at);

create table if not exists public.performance_trace_chunks (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete cascade,
  account_id text not null,
  datasource text not null,
  chunk_start timestamptz not null,
  chunk_end timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'syncing', 'ready', 'partial', 'failed')),
  point_count integer not null default 0 check (point_count >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  source_cursor text,
  last_error text,
  synced_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint performance_trace_chunks_window_valid
    check (chunk_start < chunk_end),
  unique (datasource, account_id, chunk_start, chunk_end)
);

create index if not exists performance_trace_chunks_missing_idx
  on public.performance_trace_chunks
  (client_id, datasource, account_id, status, chunk_start, chunk_end);

-- Chunks are an ingestion work queue. Overlapping windows for a datasource and
-- account would ingest the same observations twice. A transaction-scoped
-- advisory lock makes the range check safe under concurrent workers without
-- assuming btree_gist is installed in every Supabase project.
create or replace function public.validate_performance_trace_chunk()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('performance_trace_chunk:' || new.datasource || ':' || new.account_id, 0)
  );

  if exists (
    select 1
    from public.performance_trace_chunks existing
    where existing.datasource = new.datasource
      and existing.account_id = new.account_id
      and existing.id is distinct from new.id
      and tstzrange(existing.chunk_start, existing.chunk_end, '[)')
          && tstzrange(new.chunk_start, new.chunk_end, '[)')
  ) then
    raise exception 'Performance trace chunks must not overlap for one account and datasource'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_performance_trace_chunk on public.performance_trace_chunks;
create trigger validate_performance_trace_chunk
  before insert or update of datasource, account_id, chunk_start, chunk_end
  on public.performance_trace_chunks
  for each row execute function public.validate_performance_trace_chunk();

drop trigger if exists set_updated_at on public.performance_trace_chunks;
create trigger set_updated_at before update on public.performance_trace_chunks
  for each row execute function public.set_updated_at();

-- RLS follows the current Performance cache contract: admins ingest/manage;
-- a client may only read rows explicitly tied to its own client_id.
alter table public.performance_trace_points enable row level security;
alter table public.performance_trace_rollups enable row level security;
alter table public.performance_trace_stationary_windows enable row level security;
alter table public.performance_trace_chunks enable row level security;

-- Explicit grants keep these tables available to PostgREST even when the
-- project's Data API is configured to stop exposing new public tables by
-- default. RLS below remains the row-level authorization boundary.
grant select, insert, update, delete
  on public.performance_trace_points,
     public.performance_trace_rollups,
     public.performance_trace_stationary_windows,
     public.performance_trace_chunks
  to authenticated;
grant usage, select
  on sequence public.performance_trace_points_id_seq,
              public.performance_trace_rollups_id_seq,
              public.performance_trace_stationary_windows_id_seq,
              public.performance_trace_chunks_id_seq
  to authenticated;

-- A migration normally runs atomically, but these drops make a manually
-- recovered/partially provisioned environment safe to converge as well.
drop policy if exists "performance trace points select" on public.performance_trace_points;
drop policy if exists "performance trace points insert" on public.performance_trace_points;
drop policy if exists "performance trace points update" on public.performance_trace_points;
drop policy if exists "performance trace points delete" on public.performance_trace_points;
drop policy if exists "performance trace rollups select" on public.performance_trace_rollups;
drop policy if exists "performance trace rollups insert" on public.performance_trace_rollups;
drop policy if exists "performance trace rollups update" on public.performance_trace_rollups;
drop policy if exists "performance trace rollups delete" on public.performance_trace_rollups;
drop policy if exists "performance stationary windows select" on public.performance_trace_stationary_windows;
drop policy if exists "performance stationary windows insert" on public.performance_trace_stationary_windows;
drop policy if exists "performance stationary windows update" on public.performance_trace_stationary_windows;
drop policy if exists "performance stationary windows delete" on public.performance_trace_stationary_windows;
drop policy if exists "performance trace chunks select" on public.performance_trace_chunks;
drop policy if exists "performance trace chunks insert" on public.performance_trace_chunks;
drop policy if exists "performance trace chunks update" on public.performance_trace_chunks;
drop policy if exists "performance trace chunks delete" on public.performance_trace_chunks;

create policy "performance trace points select" on public.performance_trace_points
  for select to authenticated
  using ((select public.is_admin()) or client_id = (select public.current_client_id()));
create policy "performance trace points insert" on public.performance_trace_points
  for insert to authenticated with check ((select public.is_admin()));
create policy "performance trace points update" on public.performance_trace_points
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "performance trace points delete" on public.performance_trace_points
  for delete to authenticated using ((select public.is_admin()));

create policy "performance trace rollups select" on public.performance_trace_rollups
  for select to authenticated
  using ((select public.is_admin()) or client_id = (select public.current_client_id()));
create policy "performance trace rollups insert" on public.performance_trace_rollups
  for insert to authenticated with check ((select public.is_admin()));
create policy "performance trace rollups update" on public.performance_trace_rollups
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "performance trace rollups delete" on public.performance_trace_rollups
  for delete to authenticated using ((select public.is_admin()));

create policy "performance stationary windows select" on public.performance_trace_stationary_windows
  for select to authenticated
  using ((select public.is_admin()) or client_id = (select public.current_client_id()));
create policy "performance stationary windows insert" on public.performance_trace_stationary_windows
  for insert to authenticated with check ((select public.is_admin()));
create policy "performance stationary windows update" on public.performance_trace_stationary_windows
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "performance stationary windows delete" on public.performance_trace_stationary_windows
  for delete to authenticated using ((select public.is_admin()));

create policy "performance trace chunks select" on public.performance_trace_chunks
  for select to authenticated
  using ((select public.is_admin()) or client_id = (select public.current_client_id()));
create policy "performance trace chunks insert" on public.performance_trace_chunks
  for insert to authenticated with check ((select public.is_admin()));
create policy "performance trace chunks update" on public.performance_trace_chunks
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "performance trace chunks delete" on public.performance_trace_chunks
  for delete to authenticated using ((select public.is_admin()));
