import { describe, expect, it } from "vitest";
import type { TaskTypeDef } from "@/lib/taskTypes";
import { flowStepTaskId } from "./ids";
import { shootDayRows } from "./shootDayRows";

const step = (key: string, label: string, order_index: number, lead_days: number) => ({
  key, label, order_index, lead_days, progress_weight: 1, default_assignee: null, client_visible: false,
  task_type_id: `type-${key}`,
  workflow_step_id: `workflow-${key}`,
});

const entrega = {
  id: "t1",
  key: "criativo",
  label: "Entrega",
  order_index: 2,
  behavior: "entrega",
  workflow_version_id: "workflow-v1",
  creatable: true,
  subtypes: [step("roteiro", "Roteiro", 1, 2), step("captacao", "Captação", 2, 3), step("edicao", "Edição", 3, 4), step("publicacao", "Publicação", 4, 2)],
} as unknown as TaskTypeDef;

const base = {
  clientId: "c1",
  type: entrega,
  shootDate: "2026-09-22",
  today: "2026-09-15",
  scriptTitle: "Roteiros da diária 22/09",
  scriptDescription: "Documento no GED",
  captureTitle: "Gravação 22/09 — 3 publicações",
  assignee: "Luiza",
  pieces: [
    { title: "Antes e depois", formato: "Reels vertical", publishDate: "2026-09-28" },
    { title: "Dicas de cuidado", formato: "Carrossel", publishDate: "2026-09-30" },
    { title: "Bastidores", formato: "Stories", publishDate: null },
  ],
  deliveryIds: ["d1", "d2", "d3"],
};

describe("shootDayRows", () => {
  it("cria uma entrega por peça, com o formato de cada uma", () => {
    const rows = shootDayRows(base);
    expect(rows.deliveries.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect(rows.deliveries.map((d) => (d.payload as Record<string, unknown>).formato)).toEqual(["Reels vertical", "Carrossel", "Stories"]);
    expect(rows.deliveries.every((d) => d.workflow_version_id === "workflow-v1")).toBe(true);
    expect(rows.deliveries[0].due_date).toBe("2026-09-28");
  });

  it("um roteiro e uma captação compartilhados, ligados nos slots de todas as entregas", () => {
    const rows = shootDayRows(base);
    expect(rows.roteiro.id).toBe(flowStepTaskId("d1", "roteiro"));
    expect(rows.captacao.id).toBe(flowStepTaskId("d1", "captacao"));
    expect(rows.links).toHaveLength(6);
    for (const delivery of ["d1", "d2", "d3"]) {
      expect(rows.links).toContainEqual({ parentId: delivery, childId: rows.roteiro.id, workflowStepId: "workflow-roteiro", slot: "roteiro", position: 1 });
      expect(rows.links).toContainEqual({ parentId: delivery, childId: rows.captacao.id, workflowStepId: "workflow-captacao", slot: "captacao", position: 2 });
    }
  });

  it("roteiro vence 4 dias antes da gravação (nunca antes de hoje) e a captação no dia", () => {
    expect(shootDayRows(base).roteiro.due_date).toBe("2026-09-18");
    expect(shootDayRows({ ...base, shootDate: "2026-09-16" }).roteiro.due_date).toBe("2026-09-15");
    expect(shootDayRows(base).captacao).toMatchObject({ due_date: "2026-09-22", subtype: "captacao", title: "Gravação 22/09 — 3 publicações" });
  });

  it("recusa tipo sem roteiro/captação e diária sem peças", () => {
    const semRoteiro = { ...entrega, subtypes: entrega.subtypes.slice(2) } as TaskTypeDef;
    expect(() => shootDayRows({ ...base, type: semRoteiro })).toThrow(/roteiro e captação/);
    expect(() => shootDayRows({ ...base, pieces: [], deliveryIds: [] })).toThrow(/pelo menos uma/);
  });
});
