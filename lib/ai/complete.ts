// Chamada mínima à Messages API da Anthropic via fetch (sem SDK, sem deps —
// decisão do usuário). Rota que usa isto roda em runtime nodejs.

import { getAiProviderSettingsService } from "./provider";

export class AiNotConfiguredError extends Error {
  constructor(message = "Provedor de IA não configurado (Configurações › Integrações).") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}
export class AiVendorUnsupportedError extends Error {
  constructor(vendor: string) {
    super(`Vendor de IA não suportado ainda: ${vendor}. Configure Anthropic.`);
    this.name = "AiVendorUnsupportedError";
  }
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Default do plano aprovado; a Anthropic recomenda claude-opus-5 como o mais
// capaz. Override por AI_MODEL para trocar sem deploy.
const MODEL = process.env.AI_MODEL ?? "claude-sonnet-5";

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  error?: { message?: string };
};

export async function aiComplete({ system, user, maxTokens = 1024 }: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const settings = await getAiProviderSettingsService();
  if (!settings?.apiKey) throw new AiNotConfiguredError();
  if (settings.vendor && settings.vendor !== "anthropic") throw new AiVendorUnsupportedError(settings.vendor);

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => null)) as AnthropicResponse | null;
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${json?.error?.message ?? "erro"}`);
  if (json?.stop_reason === "refusal") throw new Error("A IA recusou o pedido.");
  const block = Array.isArray(json?.content) ? json.content.find((b) => b.type === "text") : null;
  return typeof block?.text === "string" ? block.text : "";
}
