import { describe, expect, it } from "vitest";
import { captureWorkspaceKey, creativeDriveAppProperties, recordedFolderAction, selectCreativeMaterialUrl } from "./creativeDriveModel";

const identity = {
  clientId: "client",
  routineTaskId: "routine",
  planTaskId: "plan",
  captureTaskId: "capture-a",
  creativeTaskId: "creative",
  stageTaskId: "shared-edit",
};

describe("creative Drive identity", () => {
  it("separa duas Captacoes mesmo quando a data seria igual", () => {
    expect(captureWorkspaceKey(identity)).toBe("plan:capture-a");
    expect(captureWorkspaceKey({ ...identity, captureTaskId: "capture-b" })).toBe("plan:capture-b");
  });

  it("registra toda a cadeia em appProperties", () => {
    expect(creativeDriveAppProperties(identity, "preview")).toEqual({
      client_id: "client", routine_task_id: "routine", plan_task_id: "plan",
      capture_task_id: "capture-a", creative_task_id: "creative", stage_task_id: "shared-edit", north_role: "preview",
    });
  });

  it("identifica a pasta da Captação compartilhada sem o Criativo", () => {
    expect(creativeDriveAppProperties(identity, "daily_root")).toEqual({
      client_id: "client", routine_task_id: "routine", plan_task_id: "plan",
      capture_task_id: "capture-a", north_role: "daily_root",
    });
    expect(creativeDriveAppProperties({ ...identity, creativeTaskId: "another" }, "daily_root"))
      .toEqual(creativeDriveAppProperties(identity, "daily_root"));
  });
});

describe("client creative material", () => {
  const assets = [
    { id: "p1", role: "preview", state: "active", web_view_link: "https://drive/preview-old", created_at: "2026-09-20" },
    { id: "p2", role: "preview", state: "active", web_view_link: "https://drive/preview-new", created_at: "2026-09-21" },
    { id: "f1", role: "final", state: "active", web_view_link: "https://drive/final", created_at: "2026-09-22" },
  ];

  it("prefere o arquivo mais recente da Home", () => {
    expect(selectCreativeMaterialUrl(assets, [{ asset_id: "f1", state: "current", version_number: 3 }])).toBe("https://drive/final");
    expect(selectCreativeMaterialUrl([...assets, { id: "f2", role: "final", state: "active", web_view_link: "https://drive/final-new", created_at: "2026-09-23" }], [])).toBe("https://drive/final-new");
  });

  it("cai apenas para o Preview individual, nunca para EDICAO", () => {
    expect(selectCreativeMaterialUrl(assets.filter((asset) => asset.role !== "final"), [])).toBe("https://drive/preview-new");
    expect(selectCreativeMaterialUrl([], [])).toBeNull();
  });
});

describe("pasta registrada reencontrada", () => {
  const folder = { state: "ok" as const, name: "Bruto - diaria de gravacao (16-09-2026)", mimeType: "application/vnd.google-apps.folder" };
  it("no lugar certo (ou no lugar antigo aceito), usa", () => {
    expect(recordedFolderAction({ ...folder, parents: ["serie"] }, "serie", "raw")).toEqual({ action: "use" });
    expect(recordedFolderAction({ ...folder, parents: ["raw"] }, "serie", "raw")).toEqual({ action: "use" });
  });
  it("sem pai (removida por quem não é dono), devolve à pasta do cliente", () => {
    expect(recordedFolderAction({ ...folder, parents: [] }, "serie", "raw")).toEqual({ action: "reattach", parentId: "raw" });
    expect(recordedFolderAction({ ...folder, parents: [] }, "diaria")).toEqual({ action: "reattach", parentId: "diaria" });
  });
  it("movida para outro lugar, na lixeira ou apagada: para e explica", () => {
    expect(recordedFolderAction({ ...folder, parents: ["outra"] }, "serie", "raw")).toMatchObject({ action: "fail", status: 409, message: expect.stringContaining("foi movida") });
    expect(recordedFolderAction({ ...folder, state: "trashed", parents: ["raw"] }, "serie", "raw")).toMatchObject({ action: "fail", message: expect.stringContaining("lixeira") });
    expect(recordedFolderAction({ ...folder, state: "missing", parents: [] }, "serie", "raw")).toMatchObject({ action: "fail", status: 502 });
  });
});
