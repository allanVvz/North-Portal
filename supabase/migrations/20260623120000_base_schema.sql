-- Base schema for the North client portal.
-- Portable/idempotent: safe to run on a fresh DB (local Docker) or an existing
-- project where the tables were created outside of migrations.
-- Order: this runs BEFORE 20260624000000_harden_client_portal.sql on fresh setups.

create extension if not exists "pgcrypto";

-- clients ---------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clients_slug_unique_idx on public.clients (slug);

-- briefing_answers (one row per client) ---------------------------------------
create table if not exists public.briefing_answers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  submitted boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index if not exists briefing_answers_client_id_unique_idx
  on public.briefing_answers (client_id);

-- client_drive_links (one row per client) -------------------------------------
create table if not exists public.client_drive_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  brand_url text,
  products_url text,
  uploads_url text,
  updated_at timestamptz not null default now()
);
create unique index if not exists client_drive_links_client_id_unique_idx
  on public.client_drive_links (client_id);

-- client_results (one row per client) -----------------------------------------
create table if not exists public.client_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  insights jsonb not null default '[]'::jsonb,
  top_metrics jsonb not null default '[]'::jsonb,
  report_url text,
  feedback_url text,
  updated_at timestamptz not null default now()
);
create unique index if not exists client_results_client_id_unique_idx
  on public.client_results (client_id);
