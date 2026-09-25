import { beforeEach, describe, expect, it, vi } from "vitest";

const drive = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/googleDriveApi", () => ({
  isGoogleDriveConfigured: () => true,
  listFolderFilesPage: drive.list,
  getDriveItemMetadata: vi.fn(),
  moveDriveItemBetweenFolders: vi.fn(),
}));

import { createFakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";
import { recordStepDelivery } from "./stepDelivery";

const LUIZA = "p-luiza";
const ALISSON = "p-alisson";

function world(options: { roteiroComments?: Row[]; captacaoComments?: Row[]; withCapture?: boolean } = {}) {
  const withCapture = options.withCapture ?? true;
  const db = createFakeTaskDb({
    tasks: [
      { id: "c1", kind: "criativo", title: "Promoções", workflow_version_id: "wv", status: "backlog", payload: { comments: [] } },
      { id: "c2", kind: "criativo", title: "Paz", workflow_version_id: "wv", status: "backlog", payload: { comments: [] } },
      { id: "roteiro", kind: "operacional", subtype: "roteiro", title: "Roteiro do bloco", status: "aprovado", assignee: "Luiza", completed_at: "2026-09-18T17:27:21.000Z", payload: { comments: options.roteiroComments ?? [] } },
      { id: "captacao", kind: "operacional", subtype: "captacao", title: "Gravação do bloco", status: "aprovado", assignee: "Alisson", completed_at: "2026-09-18T17:27:21.000Z", payload: { comments: options.captacaoComments ?? [] } },
    ],
    task_links: [
      { parent_id: "c1", child_id: "roteiro", relation_kind: "workflow_step" },
      { parent_id: "c2", child_id: "roteiro", relation_kind: "workflow_step" },
      { parent_id: "c1", child_id: "captacao", relation_kind: "workflow_step" },
      { parent_id: "c2", child_id: "captacao", relation_kind: "workflow_step" },
    ],
    task_assignees: [],
    profiles: [{ id: LUIZA, full_name: "Luiza" }, { id: ALISSON, full_name: "Alisson" }],
    drive_capture_workspaces: withCapture ? [{ id: "diaria", capture_task_id: "captacao", capture_date: "2026-09-16", script_folder_id: "pasta-roteiro", capture_folder_id: "pasta-captacao" }] : [],
    drive_creative_workspaces: withCapture ? [{ creative_task_id: "c1", capture_workspace_id: "diaria" }, { creative_task_id: "c2", capture_workspace_id: "diaria" }] : [],
  });
  db.profiles.set(LUIZA, "Luiza");
  db.profiles.set(ALISSON, "Alisson");
  return db;
}

let contents: Record<string, Array<{ id: string; name: string; webViewLink?: string }>>;

beforeEach(() => {
  vi.clearAllMocks();
  contents = {
    "pasta-roteiro": [{ id: "doc1", name: "Roteiros BAITA — Setembro", webViewLink: "https://docs.google.com/document/d/doc1/edit" }],
    "pasta-captacao": [{ id: "b1", name: "IMG_1.MOV" }, { id: "b2", name: "IMG_2.MOV" }, { id: "b3", name: "IMG_3.MOV" }],
  };
  drive.list.mockImplementation(async (folder: string) => ({
    files: (contents[folder] ?? []).map((file) => ({ ...file, mimeType: "video/mp4" })), nextPageToken: null,
  }));
});

describe("entrega do Roteiro", () => {
  it("Luiza entrega os arquivos da pasta Roteiro da diária, contando os criativos", async () => {
    const db = world();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "roteiro");
    const [comment] = db.comments("roteiro");
    expect(comment.author).toBe("Luiza");
    expect(comment.text).toBe("📝 Roteiro aprovado — 2 criativos prontos para gravar.\n[Roteiros BAITA — Setembro](https://docs.google.com/document/d/doc1/edit)");
  });

  it("pasta Roteiro vazia: entrega a pasta, que abre como grade", async () => {
    contents["pasta-roteiro"] = [];
    const db = world();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "roteiro");
    expect(String(db.comments("roteiro")[0].text)).toContain("[Roteiros · diária 16/09](https://drive.google.com/drive/folders/pasta-roteiro)");
  });

  it("sem diária: usa o último link do Drive já comentado na etapa", async () => {
    const db = world({ withCapture: false, roteiroComments: [{ author: "Cintia", text: "Todos os roteiros com OK: https://docs.google.com/document/d/abc123def456/edit", at: "2026-09-18T17:27:00.000Z" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "roteiro");
    const delivery = db.comments("roteiro").at(-1)!;
    expect(delivery.author).toBe("Luiza");
    expect(String(delivery.text)).toContain("[Roteiro](https://docs.google.com/document/d/abc123def456/edit)");
  });

  it("sem arquivo nenhum não comenta — marco sem entrega não entra", async () => {
    const db = world({ withCapture: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "roteiro");
    expect(db.comments("roteiro")).toEqual([]);
  });
});

describe("entrega da Captação", () => {
  it("Alisson entrega a pasta da diária, com a contagem de brutos e o próximo passo", async () => {
    const db = world();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "captacao");
    const [comment] = db.comments("captacao");
    expect(comment.author).toBe("Alisson");
    expect(comment.text).toBe("🎬 Gravação concluída — os 3 brutos da diária estão na pasta. Próximo passo: Edição.\n[Captação · diária 16/09](https://drive.google.com/drive/folders/pasta-captacao)");
  });

  it("reaprovar no mesmo dia não duplica a entrega", async () => {
    const db = world();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "captacao");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "captacao");
    expect(db.comments("captacao")).toHaveLength(1);
  });

  it("etapa que não é Roteiro nem Captação: nada", async () => {
    const db = world();
    db.task("captacao")!.subtype = "edicao";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordStepDelivery(db as any, "captacao");
    expect(db.comments("captacao")).toEqual([]);
  });
});
