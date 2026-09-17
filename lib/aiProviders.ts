// AI provider connector metadata for Configurações → Integrações. Shared
// between the client component and server validation so the vendor/model
// list has one source of truth (same idiom as lib/windsor.ts's
// WINDSOR_DATASOURCES). The credential itself (API key) lives only in the
// vault, referenced by an integration_credentials row (provider='ai',
// scope='agency') — see getAiProviderSettings/saveAiProviderSettings in
// lib/supabase.ts.

/** OpenAI is the sole production provider. Multi-provider routing belongs to
 * the future Harness/OpenRouter work, not to this integration. */
export type AiVendor = "openai";

export const AI_PROVIDER = {
  key: "openai" as const,
  label: "OpenAI · GPT",
  models: ["GPT-5", "GPT-5 mini"],
};

export type AiProviderSettings = {
  apiKey: string;
  vendor: AiVendor;
};

export const AI_PROVIDER_SETTINGS_DEFAULT: AiProviderSettings = {
  apiKey: "",
  vendor: "openai",
};
