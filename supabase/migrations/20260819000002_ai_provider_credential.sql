-- Configurações → Integrações → Provedor de IA was UI-mock-only (local
-- component state, no save/vault call) because integration_credentials.provider
-- only allowed 'windsor'/'meta' (see 20260813000001_credential_vault.sql).
-- Add 'ai' so the same vault-backed pattern already used for Windsor/Meta
-- (one integration_credentials row, scope='agency', vault_secret_id holds the
-- real key) can hold the OpenAI API key. Provider metadata remains in this
-- row only for forward-compatible auditing; OpenAI is the sole active vendor.

alter table public.integration_credentials
  drop constraint integration_credentials_provider_check;

alter table public.integration_credentials
  add constraint integration_credentials_provider_check
  check (provider in ('windsor', 'meta', 'ai'));
