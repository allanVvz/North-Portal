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

import { returnEditFinalsToPreview, syncCreativeDriveFolders } from "./creativeDriveSync";
import { BAITA_DRIVE_PLAN_ID } from "./cardMaterials";

const workspace = {
  id: "workspace", plan_task_id: BAITA_DRIVE_PLAN_ID, creative_task_id: "creative", stage_task_id: "edit",
  creative_folder_id: "creative-root", raw_folder_id: null, preview_folder_id: "preview-root",
  status: "ready", last_error: null,
};

type Call = [string, Record<string, unknown>];
const REGISTER = new Set(["register_drive_folder_asset", "register_drive_raw_folder_asset"]);

/** Banco mínimo: registra as RPCs e responde às leituras que a sincronização
 *  faz. `finals` = drive_file_ids que já eram finais ativos; `folders` = as
 *  pastas de criativo que `returnEditFinalsToPreview` encontra. */
function fakeDb(options: {
  finals?: string[];
  folders?: Array<Record<string, unknown>>;
  stageStatus?: string;
  statusOverride?: string | null;
} = {}) {
  const rpc = vi.fn(async (_name: string, _params: Record<string, unknown>) => ({ data: { inserted: true, task: { id: "x" } }, error: null }));
  const inFilter: string[][] = [];
  // O resultado é calculado na LEITURA, depois dos filtros encadeados.
  const chain = (result: () => unknown) => {
    const node: Record<string, unknown> = {};
    for (const op of ["select", "eq", "update"]) node[op] = () => node;
    node.in = (_col: string, values: string[]) => { inFilter.push(values); return node; };
    node.maybeSingle = async () => result();
    node.then = (resolve: (value: unknown) => void) => resolve(result());
    return node;
  };
  const db = {
    rpc,
    from: (table: string) => {
      if (table === "drive_assets") return chain(() => ({ data: (options.finals ?? []).map((id) => ({ drive_file_id: id })), error: null }));
      if (table === "drive_creative_workspaces") {
        return chain(() => ({
          data: (options.folders ?? []).filter((folder) => !inFilter.length || inFilter.at(-1)!.includes(folder.creative_task_id as string)),
          error: null,
        }));
      }
      if (table === "tasks") return chain(() => ({ data: { status: options.stageStatus ?? "revisao" }, error: null }));
      if (table === "task_links") return chain(() => ({ data: { status_override: options.statusOverride ?? null }, error: null }));
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const registers = () => (rpc.mock.calls as unknown as Call[]).filter(([name]) => REGISTER.has(name));
  const comments = () => (rpc.mock.calls as unknown as Call[]).filter(([name]) => name === "automation_task_payload_update");
  return { db, rpc, registers, comments };
}

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
    const { db, registers } = fakeDb();
    await syncCreativeDriveFolders(db as never, workspace);
    expect(registers().map((call) => call[1].p_drive_file_id)).toEqual(["audio", "video"]);
    expect(registers().every((call) => call[1].p_role === "final")).toBe(true);
    expect(drive.move).not.toHaveBeenCalled();
  });

  it("skips a file moved to another folder while reconciliation runs", async () => {
    drive.metadata.mockImplementation(async (id: string) => ({ id, name: id, mimeType: "video/mp4", size: 123, parents: ["other"] }));
    const { db, registers } = fakeDb();
    const result = await syncCreativeDriveFolders(db as never, workspace);
    expect(registers()).toEqual([]);
    expect(result.newHomeFiles).toEqual([]);
  });

  it("registers a file placed in Raw as raw and never as a final", async () => {
    drive.list.mockImplementation(async (folder: string) => ({ files: folder === "raw-root" ? [
      { id: "audio", name: "Trilha.mp3", mimeType: "audio/mpeg", createdTime: "2026-09-24T22:31:00Z" },
    ] : [], nextPageToken: null }));
    drive.metadata.mockResolvedValue({ id: "audio", name: "Trilha.mp3", mimeType: "audio/mpeg", size: 100, parents: ["raw-root"] });
    const { db, registers } = fakeDb();
    await syncCreativeDriveFolders(db as never, { ...workspace, raw_folder_id: "raw-root" });
    expect(registers()).toEqual([["register_drive_raw_folder_asset", expect.objectContaining({ p_drive_file_id: "audio" })]]);
  });

  // "Arquivo novo na Home → Revisão" (lib/flows/homeArrival.ts) começa aqui:
  // a sincronização diz o que CHEGOU, e só o que chegou.
  it("reports only the root files that were not active finals before as new Home arrivals", async () => {
    const { db } = fakeDb({ finals: ["audio"] });
    const result = await syncCreativeDriveFolders(db as never, workspace);
    expect(result.newHomeFiles.map((file) => file.id)).toEqual(["video"]);
  });

  it("a final that had gone back to Preview and returns to the Home counts as a new arrival", async () => {
    // Nenhum dos dois é final ativo agora (os dois voltaram a ser preview).
    const { db } = fakeDb({ finals: [] });
    const result = await syncCreativeDriveFolders(db as never, workspace);
    expect(result.newHomeFiles.map((file) => file.id)).toEqual(["audio", "video"]);
  });
});

describe("returnEditFinalsToPreview — só os criativos que voltaram", () => {
  // O caso real de 25/09: a "Edição — 6 Reels" controla várias pastas, e
  // reabrir a Edição só de um criativo varria todas.
  const folders = [
    { ...workspace, id: "ws-a", creative_task_id: "creative-a", creative_folder_id: "root-a", preview_folder_id: "preview-a" },
    { ...workspace, id: "ws-b", creative_task_id: "creative-b", creative_folder_id: "root-b", preview_folder_id: "preview-b" },
  ];
  let parents: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    parents = new Map([["final-a", "root-a"], ["final-b", "root-b"]]);
    drive.list.mockImplementation(async (folder: string) => ({ files: [
      ...["final-a", "final-b"].filter((id) => parents.get(id) === folder).map((id) => ({ id, name: `${id}.mp4`, mimeType: "video/mp4", createdTime: "2026-09-24T21:00:00Z" })),
      ...(folder.startsWith("root-") ? [{ id: `shortcut-${folder}`, name: "Bruto", mimeType: "application/vnd.google-apps.shortcut" }] : []),
    ], nextPageToken: null }));
    drive.metadata.mockImplementation(async (id: string) => ({ id, name: `${id}.mp4`, mimeType: "video/mp4", size: 100, parents: [parents.get(id)] }));
    drive.move.mockImplementation(async (id: string, _from: string, to: string) => { parents.set(id, to); });
  });

  it("moves each listed creative's finals into its own Preview, never raw shortcuts", async () => {
    const { db, registers } = fakeDb({ folders });
    const result = await returnEditFinalsToPreview(db as never, "edit", ["creative-a", "creative-b"]);
    expect(result).toEqual({ moved: 2, errors: [] });
    expect(drive.move.mock.calls).toEqual([["final-a", "root-a", "preview-a"], ["final-b", "root-b", "preview-b"]]);
    expect(registers().map((call) => [call[1].p_drive_file_id, call[1].p_role])).toEqual([
      ["final-a", "final"], ["final-a", "preview"],
      ["final-b", "final"], ["final-b", "preview"],
    ]);
  });

  it("REGRESSÃO 25/09 — reabrir um criativo não mexe nos finais dos outros", async () => {
    const { db } = fakeDb({ folders });
    const result = await returnEditFinalsToPreview(db as never, "edit", ["creative-a"]);
    expect(result.moved).toBe(1);
    expect(drive.move.mock.calls).toEqual([["final-a", "root-a", "preview-a"]]);
    expect(parents.get("final-b")).toBe("root-b");
  });

  it("sem criativo afetado, não toca em pasta nenhuma", async () => {
    const { db, rpc } = fakeDb({ folders });
    expect(await returnEditFinalsToPreview(db as never, "edit", [])).toEqual({ moved: 0, errors: [] });
    expect(drive.list).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("comenta no card do criativo, como North Ai, com os nomes dos arquivos — e só no que mudou", async () => {
    const { db, comments } = fakeDb({ folders });
    await returnEditFinalsToPreview(db as never, "edit", ["creative-a"]);
    expect(comments()).toHaveLength(1);
    const [, params] = comments()[0];
    expect(params.p_task_id).toBe("creative-a");
    expect(String(params.p_comment_text)).toContain("os finais voltaram para Preview: final-a.mp4");
    expect(String(params.p_comment_id)).toMatch(/^finals-to-preview:[0-9a-f]{24}$/);
  });
});

describe("pendência de mover finais usa o status da Edição PARA ESTE criativo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drive.list.mockImplementation(async (folder: string) => ({ files: folder === "creative-root"
      ? [{ id: "final", name: "Final.mp4", mimeType: "video/mp4", createdTime: "2026-09-24T21:00:00Z" }] : [], nextPageToken: null }));
    drive.metadata.mockImplementation(async (id: string) => ({ id, name: "Final.mp4", mimeType: "video/mp4", size: 1, parents: ["creative-root"] }));
  });
  const pending = { ...workspace, last_error: "final_move_pending: falha anterior" };

  it("etapa em Revisão, mas este criativo voltou para produção: move", async () => {
    const { db } = fakeDb({ stageStatus: "revisao", statusOverride: "em_producao" });
    await syncCreativeDriveFolders(db as never, pending);
    expect(drive.move).toHaveBeenCalledWith("final", "creative-root", "preview-root");
  });

  it("etapa em produção, mas este criativo tem andamento próprio em Revisão: não move", async () => {
    const { db } = fakeDb({ stageStatus: "em_producao", statusOverride: "revisao" });
    await syncCreativeDriveFolders(db as never, pending);
    expect(drive.move).not.toHaveBeenCalled();
  });
});
