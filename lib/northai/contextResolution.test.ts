import { describe, expect, it } from "vitest";
import { resolveNorthAiContext } from "./contextResolution";

describe("resolveNorthAiContext", () => {
  it("menção estruturada ganha da conversa e do workspace", () => {
    expect(resolveNorthAiContext({ mentionClientId: "tock", threadClientId: "bruno", workspaceClientId: "bruno" })).toEqual({ clientId: "tock", source: "mention", conflict: null });
  });

  it("sem menção, o cliente citado no texto vale (compatibilidade), depois a conversa, depois o workspace", () => {
    expect(resolveNorthAiContext({ textClientId: "tock", threadClientId: "bruno" }).clientId).toBe("tock");
    expect(resolveNorthAiContext({ threadClientId: "bruno", workspaceClientId: "baita" })).toMatchObject({ clientId: "bruno", source: "thread" });
    expect(resolveNorthAiContext({ workspaceClientId: "baita" })).toMatchObject({ clientId: "baita", source: "workspace" });
    expect(resolveNorthAiContext({})).toEqual({ clientId: null, source: null, conflict: null });
  });

  it("menção e texto em clientes diferentes viram conflito explícito", () => {
    expect(resolveNorthAiContext({ mentionClientId: "tock", textClientId: "baita", threadClientId: "bruno" }).conflict).toEqual({ mentionClientId: "tock", textClientId: "baita" });
    expect(resolveNorthAiContext({ mentionClientId: "tock", textClientId: "tock" }).conflict).toBeNull();
  });
});
