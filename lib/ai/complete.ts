// OpenAI-only completion call (no SDK). The deterministic parser remains the
// normal path; this module is reached only through its explicit fallback.

import { createHash } from "node:crypto";
import { getAiProviderSettingsService } from "./provider";

export class AiNotConfiguredError extends Error {
  constructor(message = "Provedor de IA não configurado (Configurações › Integrações).") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export class AiModelUnavailableError extends Error {
  constructor(readonly model: string) {
    super(`Modelo de IA indisponivel para esta credencial: ${model}`);
    this.name = "AiModelUnavailableError";
  }
}

export class AiModelPreflightError extends Error {
  constructor(readonly status: number) {
    super(`Nao foi possivel validar os modelos da IA (OpenAI ${status}).`);
    this.name = "AiModelPreflightError";
  }
}

type OpenAiResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string };
};

type OpenAiModelsResponse = {
  data?: Array<{ id?: string }>;
};

const MODEL_PREFLIGHT_TTL_MS = 5 * 60_000;
const modelPreflightCache = new Map<string, number>();

/** Server-only availability check. The credential stays in the Authorization
 * header and neither the key nor the provider response is returned/logged. */
async function assertOpenAiModelAvailable(apiKey: string, model: string): Promise<void> {
  const cacheKey = createHash("sha256").update(`${apiKey}\0${model}`).digest("hex");
  const cachedUntil = modelPreflightCache.get(cacheKey) ?? 0;
  if (cachedUntil > Date.now()) return;
  const res = await fetch(OPENAI_MODELS_URL, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new AiModelPreflightError(res.status);
  const json = (await res.json().catch(() => null)) as OpenAiModelsResponse | null;
  const available = json?.data?.some((entry) => entry?.id === model) ?? false;
  if (!available) throw new AiModelUnavailableError(model);
  // NorthAI and Dashboard Architect normally run back-to-back with the same
  // credential/model. A short server-memory cache avoids a second /models
  // round trip without persisting or exposing the credential.
  modelPreflightCache.set(cacheKey, Date.now() + MODEL_PREFLIGHT_TTL_MS);
}

// GPT-5 uses `max_completion_tokens`. The caller parses the JSON-shaped text,
// keeping this small transport layer independent from a specific workflow.
async function completeOpenAi(apiKey: string, system: string, user: string, maxTokens: number, model?: string): Promise<string> {
  const selectedModel = model?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  await assertOpenAiModelAvailable(apiKey, selectedModel);
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: selectedModel,
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
