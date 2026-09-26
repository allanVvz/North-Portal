import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb } from "@/lib/testing/fakeTaskDb";
import { ensureDailySeries } from "./dailySeries";

const drive = vi.hoisted(() => ({ folder: vi.fn(), document: vi.fn(), metadata: vi.fn(), shortcut: vi.fn() }));
vi.mock("@/lib/googleDriveApi", () => ({
  ensureDriveFolder: drive.folder,
  ensureDriveDocument: drive.document,
  getDriveItemMetadata: drive.metadata,
  createDriveShortcut: drive.shortcut,
}));

const CONFIG = "00000000-0000-4000-8000-000000000001";
const PLAN = "00000000-0000-4000-8000-000000000002";
const CLIENT = "00000000-0000-4000-8000-000000000003";
const DELIVERY = "00000000-0000-4000-8000-000000000004";
const PIECE = "00000000-0000-4000-8000-000000000005";
const URL = "https://docs.google.com/document/d/canonical123/edit";

function world(scriptDocUrl?: string) {
  return createFakeTaskDb({
    automation_configs: [{ id: CONFIG, automation_key: "diaria_recorrente", target_task_id: PLAN,
      updated_at: "2026-09-26T00:00:00Z", daily_config: {
        clientId: CLIENT, deliveryTypeId: DELIVERY, pieces: [{ key: PIECE, name: "Reels", format: "Reels", offsetDays: 3 }],
        ...(scriptDocUrl ? { scriptDocUrl } : {}),
      } }],
    tasks: [{ id: PLAN, title: "Diária recorrente", kind: "plano_acao", client_id: CLIENT }],
    client_drive_links: [{ client_id: CLIENT, raw_folder_id: "raw-client" }],
  });
}

beforeEach(() => {
  Object.values(drive).forEach((mock) => mock.mockReset());
  drive.folder.mockResolvedValue({ id: "series-folder" });
  drive.document.mockResolvedValue({ id: "canonical123", name: "Roteiro único", mimeType: "application/vnd.google-apps.document" });
  drive.metadata.mockResolvedValue({ id: "canonical123", name: "Roteiro único", mimeType: "application/vnd.google-apps.document", parents: ["series-folder"] });
  drive.shortcut.mockResolvedValue("shortcut");
});

describe("série da diária", () => {
  it("cria um único Doc e grava o link na automação para os ciclos seguintes", async () => {
    const db = world();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await ensureDailySeries(db as any, CONFIG)).toMatchObject({ folderId: "series-folder", docUrl: URL });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureDailySeries(db as any, CONFIG);
    expect(drive.document).toHaveBeenCalledTimes(1);
    expect(drive.folder).toHaveBeenCalledWith(expect.objectContaining({
      parentId: "raw-client", appProperties: expect.objectContaining({ automation_config_id: CONFIG }),
    }));
    expect((db.table("automation_configs")[0].daily_config as { scriptDocUrl: string }).scriptDocUrl).toBe(URL);
    expect(drive.shortcut).not.toHaveBeenCalled();
  });

  it("usa o Doc informado pela roteirista e cria um atalho na pasta geral", async () => {
    const db = world(URL);
    drive.metadata.mockResolvedValue({ id: "canonical123", name: "Roteiro externo", mimeType: "application/vnd.google-apps.document", parents: ["outside"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureDailySeries(db as any, CONFIG);
    expect(drive.document).not.toHaveBeenCalled();
    expect(drive.shortcut).toHaveBeenCalledWith(expect.objectContaining({ parentId: "series-folder", targetId: "canonical123" }));
  });
});
