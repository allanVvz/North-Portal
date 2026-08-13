-- Credential Vault: real encryption for third-party secrets (Windsor.ai API key,
-- Meta OAuth tokens, client-submitted platform passwords). Backed by the
-- already-installed supabase_vault extension (pgsodium, authenticated
-- encryption) instead of a hand-rolled AES scheme. vault.secrets/
-- vault.decrypted_secrets live in the `vault` schema and are never exposed via
-- PostgREST, so access goes through SECURITY DEFINER wrappers below.

-- client_platform_credentials will store its password as a vault secret too
-- (see migration 20260813000002) — the column is added here, before the vault
-- functions, so vault_authorized() below can reference it.
alter table public.client_platform_credentials add column if not exists vault_secret_id uuid;

-- Two classes of caller may touch a secret: agency admins (Windsor/Meta
-- integration_credentials — agency-wide) and clients acting on their OWN
-- Acessos & Pastas row (owns_client(), same helper every other RLS policy on
-- that table already uses). vault_authorized() is the single place that
-- encodes "is this caller allowed to touch this specific secret id".
create or replace function public.vault_authorized(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.client_platform_credentials c
      where c.vault_secret_id = p_id and public.owns_client(c.client_id)
    );
$$;

-- Creating a brand-new secret has nothing to authorize against yet (the row
-- that will reference it doesn't exist until the caller's own follow-up
-- insert/update, which is itself RLS-protected) — any authenticated caller
-- may mint one. Reading/updating/deleting an EXISTING secret requires
-- vault_authorized().
create or replace function public.vault_set_secret(p_secret text, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;
  v_id := vault.create_secret(p_secret, p_name);
  return v_id;
end;
$$;

create or replace function public.vault_update_secret(p_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if not public.vault_authorized(p_id) then
    raise exception 'forbidden';
  end if;
  perform vault.update_secret(p_id, p_secret);
end;
$$;

create or replace function public.vault_read_secret(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  if not public.vault_authorized(p_id) then
    raise exception 'forbidden';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = p_id;
  return v_secret;
end;
$$;

create or replace function public.vault_delete_secret(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if not public.vault_authorized(p_id) then
    raise exception 'forbidden';
  end if;
  delete from vault.secrets where id = p_id;
end;
$$;

revoke all on function public.vault_authorized(uuid) from public;
revoke all on function public.vault_set_secret(text, text) from public;
revoke all on function public.vault_update_secret(uuid, text) from public;
revoke all on function public.vault_read_secret(uuid) from public;
revoke all on function public.vault_delete_secret(uuid) from public;
grant execute on function public.vault_set_secret(text, text) to authenticated;
grant execute on function public.vault_update_secret(uuid, text) to authenticated;
grant execute on function public.vault_read_secret(uuid) to authenticated;
grant execute on function public.vault_delete_secret(uuid) to authenticated;

-- Unified credential store for agency-level integrations (Windsor.ai, Meta).
-- The actual secret (API key / OAuth token) lives only in vault.secrets,
-- referenced by vault_secret_id; this table only ever holds non-sensitive
-- metadata. (Distinct from client_platform_credentials, which is per-client
-- Acessos & Pastas logins, not an "integration".)
create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('windsor', 'meta')),
  scope text not null default 'agency' check (scope in ('agency', 'client')),
  client_id uuid references public.clients(id) on delete cascade,
  label text not null default '',
  vault_secret_id uuid not null,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'connected' check (status in ('connected', 'expired', 'error', 'disconnected')),
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  updated_at timestamptz not null default now(),
  check (scope = 'agency' or client_id is not null)
);

drop trigger if exists set_updated_at on public.integration_credentials;
create trigger set_updated_at before update on public.integration_credentials
  for each row execute function public.set_updated_at();

alter table public.integration_credentials enable row level security;

create policy "integration credentials admin all" on public.integration_credentials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Migrate the existing plaintext Windsor API key (site_settings.windsor_integration)
-- into the vault. site_settings row is left in place (now orphaned/unread by the
-- app once lib/supabase.ts switches over) rather than dropped, to keep this
-- migration additive and reversible.
do $$
declare
  v_value jsonb;
  v_api_key text;
  v_secret_id uuid;
begin
  select value into v_value from public.site_settings where key = 'windsor_integration';
  if v_value is not null then
    v_api_key := v_value->>'apiKey';
    if v_api_key is not null and v_api_key <> '' then
      v_secret_id := vault.create_secret(v_api_key, 'windsor_integration_api_key');
      insert into public.integration_credentials
        (provider, scope, label, vault_secret_id, meta, status)
      values (
        'windsor',
        'agency',
        'Windsor.ai',
        v_secret_id,
        jsonb_build_object(
          'datasources', coalesce(v_value->'datasources', '{}'::jsonb),
          'accountMap', coalesce(v_value->'accountMap', '{}'::jsonb)
        ),
        'connected'
      );
    end if;
  end if;
end;
$$;
