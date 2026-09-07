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

  // A queixa era "vejo notificação quando nada foi efetivamente editado".
  // Estes três casos são o que produzia um PATCH sem edição humana nenhuma —
  // e cada PATCH virava um aviso na caixa de todos os envolvidos.
  describe("o que NÃO conta como edição", () => {
    it("vazio é vazio: null, undefined e string em branco não se diferenciam", () => {
      expect(diffTaskPatch({ description: "" }, { description: null })).toEqual({});
      expect(diffTaskPatch({ description: null }, { description: undefined })).toEqual({});
      expect(diffTaskPatch({ subtype: "" }, { subtype: null })).toEqual({});
    });

    it("desmarcar e remarcar um dia da recorrência não é edição", () => {
      expect(diffTaskPatch({ recurrence_weekdays: [3, 1] }, { recurrence_weekdays: [1, 3] })).toEqual({});
      expect(diffTaskPatch({ assignee_profile_ids: ["b", "a"] }, { assignee_profile_ids: ["a", "b"] })).toEqual({});
    });

    it("chave ausente e chave nula no payload são a mesma coisa", () => {
      expect(diffTaskPatch({ payload_patch: { formato: "Reel", hora: null } }, { payload_patch: { formato: "Reel" } })).toEqual({});
    });
  });

  // O outro lado do mesmo cuidado: normalizar demais faria uma edição real
  // deixar de salvar, que é muito pior do que uma notificação a mais.
  describe("o que ainda conta", () => {
    it("preencher um campo que estava vazio salva", () => {
      expect(diffTaskPatch({ description: "agora tem" }, { description: null })).toEqual({ description: "agora tem" });
    });

    it("apagar um campo que tinha conteúdo salva", () => {
      expect(diffTaskPatch({ description: "" }, { description: "tinha" })).toEqual({ description: "" });
    });

    it("acrescentar um dia à recorrência salva", () => {
      expect(diffTaskPatch({ recurrence_weekdays: [1, 3] }, { recurrence_weekdays: [1] })).toEqual({ recurrence_weekdays: [1, 3] });
    });

    it("zero e false não são 'vazio'", () => {
      expect(diffTaskPatch({ progress_weight: 0 }, { progress_weight: 1 })).toEqual({ progress_weight: 0 });
      expect(diffTaskPatch({ client_visible: false }, { client_visible: true })).toEqual({ client_visible: false });
    });
  });
});