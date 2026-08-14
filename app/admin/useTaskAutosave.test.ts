import { describe, expect, it } from "vitest";
import { diffTaskPatch } from "./useTaskAutosave";

describe("diffTaskPatch", () => {
  it("não envia rascunho sem diferenças normalizadas", () => {
    expect(diffTaskPatch({ title: "Card", priority: "media" }, { title: "Card", priority: "media" })).toEqual({});
  });

  it("envia somente campos alterados, inclusive remoções", () => {
    expect(diffTaskPatch({ title: "Novo", description: null }, { title: "Antigo", description: "Texto", status: "backlog" }))
      .toEqual({ title: "Novo", description: null });
  });

  it("compara arrays e patches de payload por valor", () => {
    expect(diffTaskPatch(
      { assignee_profile_ids: ["a"], payload_patch: { formato: "Reel" } },
      { assignee_profile_ids: ["a"], payload_patch: { formato: "Feed" } },
    )).toEqual({ payload_patch: { formato: "Reel" } });
  });
});
