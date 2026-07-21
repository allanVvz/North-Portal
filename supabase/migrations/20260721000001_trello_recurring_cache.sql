-- Cached, normalized Trello recurring feed. One row per board: the whole feed
-- is a single derived artifact, so there is nothing to shard per client.
--
-- Before this table the admin home fetched Trello five times, uncached, inside
-- its own render — every navigation to /admin waited on a third party with a
-- 12s timeout per call. The page now reads this table and never touches the
-- Trello API during rendering.
--
-- Unlike meta_insights_cache this is internal board data, so there is no
-- client-facing read policy.
create table if not exists public.trello_recurring_cache (
  id uuid primary key default gen_random_uuid(),
  board_id text not null,
  board_url text,
  payload jsonb not null default '[]'::jsonb, -- normalized RecurringTask[]
  card_count integer not null default 0,
  connected boolean not null default false,
  -- Set when a refresh fails. payload/fetched_at are deliberately left alone so
  -- a transient Trello outage degrades to stale data instead of an empty board.
  last_error text,
  last_error_at timestamptz,
  fetched_at timestamptz not null default now() -- last SUCCESSFUL fetch
);

create unique index if not exists trello_recurring_cache_board_idx
  on public.trello_recurring_cache (board_id);

alter table public.trello_recurring_cache enable row level security;

create policy "trello_recurring_cache admin all" on public.trello_recurring_cache
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Explicit grants are required by the Data API defaults introduced in 2026.
grant select, insert, update, delete on public.trello_recurring_cache to authenticated;
grant select, insert, update, delete on public.trello_recurring_cache to service_role;
