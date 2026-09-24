import { describe, expect, it } from "vitest";
import { creativeWorkspacesForCard, materialCardsOf, materialCoverCandidates, type CreativeMaterialWorkspace } from "./cardMaterials";
import type { TaskRecord } from "./validation";

function card(id: string, kind: string, parents: Array<{ id: string; relation_kind: string }> = [], extras: Record<string, unknown> = {}): TaskRecord {
  return { id, kind, subtype: null, parents, payload: {}, ...extras } as unknown as TaskRecord;
}

function workspace(creativeId: string, captureId: string, finalFileId: string, promotedAt: string): CreativeMaterialWorkspace {
  return {
    id: `workspace-${creativeId}`, plan_task_id: "plan-a", capture_task_id: captureId,
    creative_task_id: creativeId, status: "ready", raw_links: [],
    assets: [{ id: `asset-${creativeId}`, drive_file_id: finalFileId, name: "final.mp4", mime_type: "video/mp4", size_bytes: 10, role: "final", state: "active", web_view_link: null, created_at: promotedAt }],
    final_versions: [{ id: `version-${creativeId}`, asset_id: `asset-${creativeId}`, version_number: 1, state: "current", promoted_at: promotedAt }],
  };
}

describe("materials in the card cascade", () => {
  const template = card("template", "plano_acao", [], { recurrence_cadence: "semanal" });
  const planA = card("plan-a", "plano_acao", [{ id: "template", relation_kind: "recurrence_execution" }], { plan_id: "template" });
  const planB = card("plan-b", "plano_acao", [{ id: "template", relation_kind: "recurrence_execution" }], { plan_id: "template" });
  const creativeA = card("creative-a", "criativo", [{ id: "plan-a", relation_kind: "structural_member" }], { workflow_version_id: "workflow" });
  const creativeB = card("creative-b", "criativo", [{ id: "plan-a", relation_kind: "structural_member" }], { workflow_version_id: "workflow" });
  const otherCycle = card("creative-other", "criativo", [{ id: "plan-b", relation_kind: "structural_member" }], { workflow_version_id: "workflow" });
  const sharedCapture = card("capture", "operacional", [{ id: "creative-a", relation_kind: "workflow_step" }, { id: "creative-b", relation_kind: "workflow_step" }]);
  const tasks = [template, planA, planB, creativeA, creativeB, otherCycle, sharedCapture];
  const workspaces = [workspace("creative-a", "capture", "older", "2026-09-20T00:00:00Z"), workspace("creative-b", "capture", "latest", "2026-09-21T00:00:00Z"), workspace("creative-other", "other-capture", "other-cycle", "2026-09-22T00:00:00Z")];

  it("deduplicates a shared stage and keeps a plan inside its execution", () => {
    expect(materialCardsOf(planA, tasks).filter((item) => item.id === "capture")).toHaveLength(1);
    expect(creativeWorkspacesForCard(planA, tasks, workspaces).map((item) => item.creative_task_id)).toEqual(["creative-a", "creative-b"]);
  });

  it("does not merge materials from different routine cycles in the template", () => {
    expect(creativeWorkspacesForCard(template, tasks, workspaces)).toEqual([]);
  });

  it("uses the latest promoted final first and keeps older finals as cover fallback", () => {
    const previous = { ...workspaces[0], final_versions: [
      ...workspaces[0].final_versions,
      { id: "previous", asset_id: "old-asset", version_number: 0, state: "superseded" as const, promoted_at: "2026-09-19T00:00:00Z" },
    ], assets: [...workspaces[0].assets, { ...workspaces[0].assets[0], id: "old-asset", drive_file_id: "fallback" }] };
    expect(materialCoverCandidates([previous, workspaces[1]]).map((item) => item.fileId)).toEqual(["latest", "older", "fallback"]);
  });
});
