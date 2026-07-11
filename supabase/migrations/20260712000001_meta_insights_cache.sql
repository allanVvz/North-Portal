-- Cached, normalized Meta post insights pulled from Windsor.ai. One row per
-- (account, datasource); payload holds the normalized MetaPost[] for the
-- covered window (always ~90 days, so period switching in the dashboard is
-- served by slicing in memory). client_id is nullable: a Windsor account the
-- admin hasn't mapped to a platform client yet still gets cached.
create table if not exists public.meta_insights_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  account_id text not null,
  datasource text not null, -- 'instagram_organic' | 'facebook_organic' | 'facebook'
  date_from date not null,
  date_to date not null,
  payload jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create unique index if not exists meta_insights_cache_account_ds_idx
  on public.meta_insights_cache (account_id, datasource);
create index if not exists meta_insights_cache_client_id_idx
  on public.meta_insights_cache (client_id);

alter table public.meta_insights_cache enable row level security;

create policy "meta_insights_cache admin all" on public.meta_insights_cache
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Future-proofing: lets a client-facing dashboard read its own cached posts.
create policy "meta_insights_cache client read own" on public.meta_insights_cache
  for select to authenticated
  using (client_id = public.current_client_id());
