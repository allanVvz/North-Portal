// Chamada mínima às APIs de completions dos provedores suportados, via fetch
// (sem SDK, sem deps — decisão do usuário). Rota que usa isto roda em runtime
// nodejs.
//
// Um vendor por vez, decidido pelo que está salvo em Configurações ›
// Integrações › Provedor de IA (`getAiProviderSettingsService`) — nunca
// hardcoded. `SUPPORTED_AI_VENDORS`/`isAiVendorSupported` (abaixo) são a
// ÚNICA fonte de verdade sobre quais vendors têm um caminho de fato
// implementado. A leitura do comentário de feedback não passa mais por aqui por
// padrão: usa o parser determinístico e só chama a IA com o fallback ligado
// (lib/ai/extractMetrics.ts → aiFallbackEnabled).

import { getAiProviderSettingsService } from "./provider";
import type { AiVendor } from "@/lib/aiProviders";

export class AiNotConfiguredError extends Error {
  constructor(message = "Provedor de IA não configurado (Configurações › Integrações).") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}
export class AiVendorUnsupportedError extends Error {
  constructor(vendor: string) {
    super(`Vendor de IA não suportado ainda: ${vendor}. Configure Anthropic ou ChatGPT.`);
    this.name = "AiVendorUnsupportedError";
  }
}

/** Vendors com um caminho de completions de fato implementado abaixo.
 * DeepSeek continua fora — a tela já deixa escolher (lib/aiProviders.ts),
 * mas cai em AiVendorUnsupportedError até alguém pedir. `null` (nunca
 * escolhido) conta como suportado: mesmo comportamento de sempre, cai no
 * default (Anthropic). */
export const SUPPORTED_AI_VENDORS: readonly AiVendor[] = ["anthropic", "chatgpt"];
export function isAiVendorSupported(vendor: AiVendor | null): boolean {
  return vendor === null || SUPPORTED_AI_VENDORS.includes(vendor);
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Default por vendor do plano aprovado — Anthropic recomenda claude-opus-5 e
// OpenAI recomenda gpt-5 como os mais capazes; ficam em sonnet/mini por
// custo. AI_MODEL sobrepõe os dois (quem troca de provedor via env já sabe
// que precisa trocar o modelo junto).
const DEFAULT_MODEL: Record<"anthropic" | "chatgpt", string> = {
  anthropic: "claude-sonnet-5",
  chatgpt: "gpt-5-mini",
};

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  error?: { message?: string };
};

type OpenAiResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string };
};

async function completeAnthropic(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? DEFAULT_MODEL.anthropic,
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

// Chat Completions da OpenAI: formato de mensagem diferente do Anthropic
// (system entra como uma mensagem com role "system", não um campo à parte),
// e a família gpt-5 usa `max_completion_tokens`, não `max_tokens` (a OpenAI
// aposentou o nome antigo nos modelos de raciocínio). Sem response_format
// forçado de propósito — extractMetrics.ts já corta o JSON do meio do texto
// por conta própria, então esta função fica genérica igual à da Anthropic,
// sem acoplar a um único chamador.
async function completeOpenAi(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? DEFAULT_MODEL.chatgpt,
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

export async function aiComplete({ system, user, maxTokens = 1024 }: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  // Backend alternativo para dev/e2e — a CLI `claude` no lugar da chave da API.
  // Gate por env, não por vendor: prod (sem AI_CLI e sem o binário) nunca entra.
  if (process.env.AI_CLI === "1") {
    const { aiCompleteViaCli } = await import("./cli");
    return aiCompleteViaCli({ system, user });
  }

  const settings = await getAiProviderSettingsService();
  if (!settings?.apiKey) throw new AiNotConfiguredError();

  const vendor = settings.vendor ?? "anthropic";
  if (vendor === "anthropic") return completeAnthropic(settings.apiKey, system, user, maxTokens);
  if (vendor === "chatgpt") return completeOpenAi(settings.apiKey, system, user, maxTokens);
  throw new AiVendorUnsupportedError(vendor);
}
