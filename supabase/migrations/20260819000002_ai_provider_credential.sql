-- Configurações → Integrações → Provedor de IA was UI-mock-only (local
-- component state, no save/vault call) because integration_credentials.provider
-- only allowed 'windsor'/'meta' (see 20260813000001_credential_vault.sql).
-- Add 'ai' so the same vault-backed pattern already used for Windsor/Meta
-- (one integration_credentials row, scope='agency', vault_secret_id holds the
-- real key) can hold the AI provider's API key. Which vendor (Anthropic/
-- ChatGPT/DeepSeek) is chosen lives in that row's `meta` jsonb, not as a
-- separate provider value — only one AI provider is ever active at a time.

alter table public.integration_credentials
  drop constraint integration_credentials_provider_check;

alter table public.integration_credentials
  add constraint integration_credentials_provider_check
  check (provider in ('windsor', 'meta', 'ai'));
