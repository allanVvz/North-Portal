import { beforeEach, describe, expect, it, vi } from "vitest";

const drive = vi.hoisted(() => ({
  list: vi.fn(), metadata: vi.fn(), move: vi.fn(),
}));
vi.mock("./googleDriveApi", () => ({
  isGoogleDriveConfigured: () => true,
  listFolderFilesPage: drive.list,
  getDriveItemMetadata: drive.metadata,
  moveDriveItemBetweenFolders: drive.move,
}));

import { syncCreativeDriveFolders } from "./creativeDriveSync";
import { BAITA_DRIVE_PLAN_ID } from "./cardMaterials";

const workspace = {
  id: "workspace", plan_task_id: BAITA_DRIVE_PLAN_ID, stage_task_id: "edit",
  creative_folder_id: "creative-root", preview_folder_id: "preview-root",
  status: "ready", last_error: null,
};

describe("Creative Drive folder reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drive.list.mockImplementation(async (folder: string) => ({ files: folder === "creative-root" ? [
      { id: "preview-root", name: "Preview", mimeType: "application/vnd.google-apps.folder", createdTime: "2026-09-01" },
      { id: "raw-link", name: "Bruto", mimeType: "application/vnd.google-apps.shortcut", createdTime: "2026-09-02" },
      { id: "video", name: "Final.mp4", mimeType: "video/mp4", createdTime: "2026-09-24T23:12:00Z" },
      { id: "audio", name: "Trilha.mp3", mimeType: "audio/mpeg", createdTime: "2026-09-24T22:31:00Z" },
    ] : [], nextPageToken: null }));
    drive.metadata.mockImplementation(async (id: string) => ({ id, name: id, mimeType: id === "audio" ? "audio/mpeg" : "video/mp4", size: 123, webViewLink: null, parents: ["creative-root"] }));
  });

  it("registers every real root file as final, oldest first, ignoring raw shortcuts", async () => {
    const rpc = vi.fn(async (_name: string, _params: Record<string, unknown>) => ({ error: null }));
    await syncCreativeDriveFolders({ rpc } as never, workspace);
    expect(rpc.mock.calls.map((call) => call[1].p_drive_file_id)).toEqual(["audio", "video"]);
    expect(rpc.mock.calls.every((call) => call[1].p_role === "final")).toBe(true);
    expect(drive.move).not.toHaveBeenCalled();
  });

  it("skips a file moved to another folder while reconciliation runs", async () => {
    drive.metadata.mockImplementation(async (id: string) => ({ id, name: id, mimeType: "video/mp4", size: 123, parents: ["other"] }));
    const rpc = vi.fn(async (_name: string, _params: Record<string, unknown>) => ({ error: null }));
    await syncCreativeDriveFolders({ rpc } as never, workspace);
    expect(rpc).not.toHaveBeenCalled();
  });
});
