-- Acessos & Pastas stored client platform passwords in plaintext
-- (client_platform_credentials.password). Move them into the same
-- supabase_vault-backed store used for integration_credentials. The
-- vault_secret_id column itself was added in 20260813000001 (needed there so
-- vault_authorized() could reference it) — this migration just backfills and
-- drops the plaintext column.

do $$
declare
  r record;
  v_secret_id uuid;
begin
  for r in select id, password from public.client_platform_credentials where password is not null and password <> '' loop
    v_secret_id := vault.create_secret(r.password, 'platform_credential_' || r.id::text);
    update public.client_platform_credentials set vault_secret_id = v_secret_id where id = r.id;
  end loop;
end;
$$;

alter table public.client_platform_credentials drop column password;
