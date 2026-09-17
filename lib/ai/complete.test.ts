import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER, AI_PROVIDER_SETTINGS_DEFAULT } from "@/lib/aiProviders";

const { getAiProviderSettingsService } = vi.hoisted(() => ({ getAiProviderSettingsService: vi.fn() }));
vi.mock("./provider", () => ({ getAiProviderSettingsService }));

import { aiComplete } from "./complete";

describe("provider de IA", () => {
  it("expõe somente OpenAI como configuração de produção", () => {
    expect(AI_PROVIDER.key).toBe("openai");
    expect(AI_PROVIDER_SETTINGS_DEFAULT.vendor).toBe("openai");
  });

  it("usa OpenAI mesmo se metadado legado de vendor estiver ausente", async () => {
    getAiProviderSettingsService.mockResolvedValue({ apiKey: "test-openai-key", vendor: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(aiComplete({ system: "s", user: "u" })).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
    getAiProviderSettingsService.mockReset();
  });
});
