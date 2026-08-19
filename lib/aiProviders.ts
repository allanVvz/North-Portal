// AI provider connector metadata for Configurações → Integrações. Shared
// between the client component and server validation so the vendor/model
// list has one source of truth (same idiom as lib/windsor.ts's
// WINDSOR_DATASOURCES). The credential itself (API key) lives only in the
// vault, referenced by an integration_credentials row (provider='ai',
// scope='agency') — see getAiProviderSettings/saveAiProviderSettings in
// lib/supabase.ts.

export type AiVendor = "anthropic" | "chatgpt" | "deepseek";

export const AI_VENDORS: { key: AiVendor; label: string; models: string[] }[] = [
  { key: "anthropic", label: "Anthropic", models: ["Claude Sonnet 5", "Claude Opus 5"] },
  { key: "chatgpt", label: "ChatGPT", models: ["GPT-5", "GPT-5 mini"] },
  { key: "deepseek", label: "DeepSeek", models: ["DeepSeek V4"] },
];

export type AiProviderSettings = {
  apiKey: string;
  vendor: AiVendor | null;
};

export const AI_PROVIDER_SETTINGS_DEFAULT: AiProviderSettings = {
  apiKey: "",
  vendor: null,
};
