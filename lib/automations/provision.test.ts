import { describe, expect, it } from "vitest";
import { clonePlan } from "./provision";
import type { AdminClient } from "./taskAccess";
import type { TaskRecord } from "@/lib/validation";

type Row = Record<string, unknown>;

function task(id: string, overrides: Partial<Row> = {}): TaskRecord {
  return {
    id, client_id: "template-client", kind: "operacional", subtype: null,
    title: id, status: "backlog", priority: "media", assignee: null,
    assignee_profile_ids: [], reviewer_id: null, approver_id: null, plan_id: null,
    parents: [], requires_review: false, requires_approval: false, due_date: null,
    start_date: null, end_date: null, scheduled_start_at: null, scheduled_end_at: null,
    progress_weight: 1, description: null, client_visible: false, payload: {}, position: 0,
    recurrence_cadence: null, recurrence_weekdays: [], recurrence_day_of_month: null,
    created_by: null, created_by_name: null, created_at: "", completed_at: null, updated_at: "",
    ...overrides,
  } as TaskRecord;
}

function fakeAdmin(tables: Record<string, Row[]>) {
  const inserts: { table: string; fields: Row }[] = [];
  const api = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return chain; },
        is: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return chain; },
        in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[column])); return chain; },
        order: () => { rows.sort((a, b) => Number(a.position) - Number(b.position)); return chain; },
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
        insert(fields: Row) {
          tables[table] = [...(tables[table] ?? []), fields];
          inserts.push({ table, fields });
          const result = { data: [fields], error: null };
          return Object.assign(Promise.resolve(result), { select: () => ({ limit: () => Promise.resolve(result) }) });
        },
      };
      return chain;
    },
  };
  return { admin: api as unknown as AdminClient, inserts };
}

describe("clonePlan", () => {
  it("clona membros pelos elos estruturais e preserva a ordem dos elos", async () => {
    const parent = task("template-plan", { kind: "plano_acao" });
    const first = task("member-first", { title: "Primeiro", position: 999 });
    const second = task("member-second", { title: "Segundo", position: 1 });
    const state = {
      tasks: [parent, first, second] as unknown as Row[],
      task_links: [
        { parent_id: parent.id, child_id: second.id, relation_kind: "structural_member", slot: null, position: 10 },
        { parent_id: parent.id, child_id: first.id, relation_kind: "structural_member", slot: null, position: 30 },
        { parent_id: parent.id, child_id: "flow-step", relation_kind: "workflow_step", slot: "roteiro", position: 20 },
      ] as Row[],
    };
    const { admin, inserts } = fakeAdmin(state);

    const cloned = await clonePlan(admin, parent, "target-client");

    const childInserts = inserts.filter(({ table, fields }) => table === "tasks" && fields.id !== cloned.id);
    expect(childInserts).toHaveLength(2);
    expect(childInserts.map(({ fields }) => fields.title)).toEqual(["Segundo", "Primeiro"]);
    expect(childInserts.every(({ fields }) => fields.plan_id === null)).toBe(true);

    const clonedLinks = inserts.filter(({ table }) => table === "task_links").map(({ fields }) => fields);
    expect(clonedLinks).toHaveLength(2);
    expect(clonedLinks.map((link) => link.position)).toEqual([10, 30]);
    expect(clonedLinks.every((link) => link.parent_id === cloned.id && link.slot === null)).toBe(true);
    expect(clonedLinks.map((link) => link.child_id)).toEqual(childInserts.map(({ fields }) => fields.id));
  });
});
