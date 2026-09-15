import { describe, expect, it } from "vitest";
import { isAiVendorSupported, SUPPORTED_AI_VENDORS } from "./complete";

// Só a função pura (`isAiVendorSupported`) — `aiComplete` em si depende de
// rede + do provedor gravado no banco (getAiProviderSettingsService), fora
// do escopo de um teste unitário.
describe("isAiVendorSupported", () => {
  it("Anthropic e ChatGPT têm um caminho implementado", () => {
    expect(isAiVendorSupported("anthropic")).toBe(true);
    expect(isAiVendorSupported("chatgpt")).toBe(true);
  });

  it("DeepSeek ainda não — a tela deixa escolher, mas ninguém pediu ainda", () => {
    expect(isAiVendorSupported("deepseek")).toBe(false);
  });

  it("null (nunca escolhido) conta como suportado — cai no default (Anthropic)", () => {
    expect(isAiVendorSupported(null)).toBe(true);
  });

  it("SUPPORTED_AI_VENDORS não inclui deepseek", () => {
    expect(SUPPORTED_AI_VENDORS).toEqual(["anthropic", "chatgpt"]);
  });
});
