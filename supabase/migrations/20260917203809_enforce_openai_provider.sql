-- OpenAI is the only production AI provider.  This only normalizes metadata;
-- the API key stays in Vault and is never selected or copied by this migration.
begin;

update public.integration_credentials
set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{vendor}', '"openai"'::jsonb, true),
    updated_at = now()
where provider = 'ai'
  and scope = 'agency';

commit;
