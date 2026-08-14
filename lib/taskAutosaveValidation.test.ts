import { describe, expect, it } from "vitest";
import { taskPatchSchema } from "./validation";

describe("payload_patch de autosave", () => {
  it("aceita atualização e remoção das propriedades públicas", () => {
    expect(taskPatchSchema.parse({ payload_patch: { formato: "Reel", hora: null } }).payload_patch)
      .toEqual({ formato: "Reel", hora: null });
  });

  it("rejeita comentários e metadados de recorrência", () => {
    expect(taskPatchSchema.safeParse({ payload_patch: { comments: [] } }).success).toBe(false);
    expect(taskPatchSchema.safeParse({ payload_patch: { recurrence_cycle: 2 } }).success).toBe(false);
  });
});
