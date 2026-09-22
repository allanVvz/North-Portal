import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER, AI_PROVIDER_SETTINGS_DEFAULT } from "@/lib/aiProviders";

const { getAiProviderSettingsService } = vi.hoisted(() => ({ getAiProviderSettingsService: vi.fn() }));
vi.mock("./provider", () => ({ getAiProviderSettingsService }));

import { AiModelUnavailableError, aiComplete } from "./complete";

describe("provider de IA", () => {
  it("expõe somente OpenAI como configuração de produção", () => {
    expect(AI_PROVIDER.key).toBe("openai");
    expect(AI_PROVIDER_SETTINGS_DEFAULT.vendor).toBe("openai");
  });

  it("usa OpenAI mesmo se metadado legado de vendor estiver ausente", async () => {
    getAiProviderSettingsService.mockResolvedValue({ apiKey: "test-openai-key", vendor: null });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(aiComplete({ system: "s", user: "u" })).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/models");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    const preflightHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(preflightHeaders.authorization).toBe("Bearer test-openai-key");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("apiKey");
  });

  it("interrompe antes da completion quando o modelo nao esta disponivel", async () => {
    getAiProviderSettingsService.mockResolvedValue({ apiKey: "secret-value", vendor: "openai" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "outro-modelo" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(aiComplete({ system: "s", user: "u", model: "gpt-4o-mini" })).rejects.toBeInstanceOf(AiModelUnavailableError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/models");
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
    getAiProviderSettingsService.mockReset();
  });
});
