import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminClient } from "./taskAccess";
import { prepareDailyCycle } from "./dailyCycle";

const provision = vi.hoisted(() => vi.fn());
const comment = vi.hoisted(() => vi.fn());
const series = vi.hoisted(() => vi.fn());
const shortcut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/creativeDrive", () => ({ provisionCreativeDriveWorkspace: provision }));
vi.mock("./dailySeries", () => ({ ensureDailySeries: series }));
vi.mock("@/lib/googleDriveApi", () => ({
  getDriveItemMetadata: vi.fn(async () => ({ id: "doc1", name: "Roteiro único", mimeType: "application/vnd.google-apps.document" })),
  createDriveShortcut: shortcut,
}));
vi.mock("./taskWrites", () => ({ automationCommentId: (...parts: string[]) => parts.join(":"), updateTaskPayload: comment }));

const PLAN = "00000000-0000-4000-8000-000000000001";
const SCRIPT = "00000000-0000-4000-8000-000000000002";
const CAPTURE = "00000000-0000-4000-8000-000000000003";
const CREATIVES = ["00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"];
const CLIENT = "00000000-0000-4000-8000-000000000006";

function admin(clientOfSecond = CLIENT): AdminClient {
  const tasks = [
    { id: SCRIPT, client_id: CLIENT, kind: "operacional" },
    { id: CAPTURE, client_id: CLIENT, kind: "operacional" },
    { id: CREATIVES[0], client_id: CLIENT, kind: "entrega_reels", payload: { daily_piece_key: "piece-1" } },
    { id: CREATIVES[1], client_id: clientOfSecond, kind: "entrega_story", payload: { daily_piece_key: "piece-2" } },
  ];
  return {
    from(table: string) {
      if (table === "tasks") return {
        select() {
          return {
            eq() { return { maybeSingle: async () => ({ data: { id: PLAN, kind: "plano_acao", client_id: CLIENT,
              payload: { daily_config_id: "config", daily_script_task_id: SCRIPT, daily_capture_task_id: CAPTURE } }, error: null }) }; },
            in: async () => ({ data: tasks, error: null }),
          };
        },
      };
      if (table === "task_links") return {
        select() { return { eq() { return this; }, order: async () => ({
          data: tasks.map((task, position) => ({ child_id: task.id, position })), error: null,
        }) }; },
      };
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as AdminClient;
}

beforeEach(() => {
  provision.mockReset();
  comment.mockReset();
  series.mockReset();
  shortcut.mockReset();
  series.mockResolvedValue({ folderId: "series", docId: "doc1", docUrl: "https://docs.google.com/document/d/doc1/edit", docName: "Roteiro único" });
  shortcut.mockResolvedValue("shortcut1");
  comment.mockResolvedValue(null);
  provision.mockImplementation(async (_db, creativeId) => ({
    status: "ready", raw_folder_id: `raw-${creativeId}`,
    capture_workspace: { daily_folder_id: "daily", script_folder_id: "script", capture_folder_id: "capture" },
  }));
});

describe("daily cycle Drive preparation", () => {
  it("prepares each Creative and records stable links on shared cards", async () => {
    const result = await prepareDailyCycle(admin(), PLAN);
    expect(result).toEqual({ total: 2, prepared: 2, errors: [] });
    expect(provision.mock.calls.map((call) => call[1])).toEqual(CREATIVES);
    expect(comment.mock.calls.map((call) => call[1])).toEqual([...CREATIVES, PLAN, SCRIPT, SCRIPT, CAPTURE, PLAN]);
    expect(comment.mock.calls[4][2].commentId).toBe(`daily-script-folder:${PLAN}`);
    expect(shortcut).toHaveBeenCalledWith(expect.objectContaining({ parentId: "script", targetId: "doc1" }));
  });

  it("retries a failed folder without recreating a cycle or changing comment keys", async () => {
    provision.mockRejectedValueOnce(new Error("Drive temporariamente indisponível"));
    const first = await prepareDailyCycle(admin(), PLAN);
    expect(first.errors).toHaveLength(1);
    expect(comment.mock.calls.some((call) => call[1] === PLAN)).toBe(false);
    const second = await prepareDailyCycle(admin(), PLAN);
    expect(second.errors).toEqual([]);
    const rawKeys = comment.mock.calls.filter((call) => call[1] === CREATIVES[1]).map((call) => call[2].commentId);
    expect(new Set(rawKeys).size).toBe(1);
  });

  it("rejects a Creative from another client before creating any folders", async () => {
    await expect(prepareDailyCycle(admin("another-client"), PLAN)).rejects.toThrow(/mesmo cliente/);
    expect(provision).not.toHaveBeenCalled();
  });
});
