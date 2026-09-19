// OpenAI-only completion call (no SDK). The deterministic parser remains the
// normal path; this module is reached only through its explicit fallback.

import { getAiProviderSettingsService } from "./provider";

export class AiNotConfiguredError extends Error {
  constructor(message = "Provedor de IA não configurado (Configurações › Integrações).") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

type OpenAiResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string };
};

// GPT-5 uses `max_completion_tokens`. The caller parses the JSON-shaped text,
// keeping this small transport layer independent from a specific workflow.
async function completeOpenAi(apiKey: string, system: string, user: string, maxTokens: number, model?: string): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => null)) as OpenAiResponse | null;
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json?.error?.message ?? "erro"}`);
  const choice = json?.choices?.[0];
  if (choice?.finish_reason === "content_filter") throw new Error("A IA recusou o pedido.");
  return typeof choice?.message?.content === "string" ? choice.message.content : "";
}

export async function aiComplete({ system, user, maxTokens = 1024, model }: {
  system: string;
  user: string;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const settings = await getAiProviderSettingsService();
  if (!settings?.apiKey) throw new AiNotConfiguredError();
  return completeOpenAi(settings.apiKey, system, user, maxTokens, model);
}
