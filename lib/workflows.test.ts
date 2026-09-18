import { describe, expect, it } from "vitest";
import { publishedWorkflowForKind, type WorkflowReader } from "./workflows";

type Row = Record<string, unknown>;

function workflowReader(tables: Record<string, Row[]>): WorkflowReader {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return chain;
        },
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      };
      return chain;
    },
  } as unknown as WorkflowReader;
}

describe("publishedWorkflowForKind", () => {
  it("resolve uma variante de Entrega filha da raiz estrutural", async () => {
    const db = workflowReader({
      task_types: [
        { id: "entrega", parent_id: null, key: "entrega" },
        { id: "criativo", parent_id: "entrega", key: "criativo" },
      ],
      workflow_versions: [
        { id: "criativo-v1", delivery_type_id: "criativo", version: 1, label: "Criativo v1", status: "published" },
      ],
      workflow_version_steps: [
        {
          id: "roteiro", workflow_version_id: "criativo-v1", task_type_id: "tarefa-roteiro",
          step_key: "roteiro", label: "Roteiro", order_index: 10, progress_weight: 1,
          lead_days: 0, creation_trigger: "delivery_created", default_assignee: null, client_visible: false,
        },
      ],
    });

    await expect(publishedWorkflowForKind(db, "criativo")).resolves.toMatchObject({
      id: "criativo-v1",
      delivery_type_id: "criativo",
      steps: [{ workflow_step_id: "roteiro", task_type_id: "tarefa-roteiro" }],
    });
  });
});
