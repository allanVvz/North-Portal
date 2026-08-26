create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 100),
  company text not null check (char_length(company) between 2 and 140),
  phone text not null,
  segment text not null,
  region text not null,
  objective text not null,
  investment text not null check (investment in ('até-3k','3k-6k','6k-12k','12k+')),
  source_page text not null default '/',
  consent_analytics boolean not null default false,
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text, gclid text,
  user_agent text,
  status text not null default 'novo' check (status in ('novo','contatado','qualificado','descartado','convertido')),
  notes text
);

alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select, update on public.leads to authenticated;

create policy "admins can read leads" on public.leads for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins can update leads" on public.leads for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);
