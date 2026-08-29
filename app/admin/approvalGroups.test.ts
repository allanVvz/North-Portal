import { describe, expect, it } from "vitest";
import { filterByClient, groupApprovalQueue, reviewQueueRows } from "./approvalGroups";
import type { TaskStatus } from "@/lib/validation";

function row(id: string, status: TaskStatus) {
  return { id, status };
}

describe("reviewQueueRows", () => {
  it("keeps only cards currently in the Revisão column", () => {
    const rows = [
      row("1", "revisao"),
      row("2", "em_producao"),
      row("3", "aprovacao"),
      row("4", "revisao"),
    ];
    expect(reviewQueueRows(rows).map((r) => r.id)).toEqual(["1", "4"]);
  });
});

describe("groupApprovalQueue", () => {
  const rows = [
    row("pending-1", "aprovacao"),
    row("pending-2", "aprovacao"),
    row("done-1", "aprovado"),
    row("revisao-1", "revisao"),
  ];
  const groups = groupApprovalQueue(rows);

  it("puts every 'aprovacao' card under 'pending', regardless of client_visible (no interno split anymore)", () => {
    expect(groups.pending.map((r) => r.id)).toEqual(["pending-1", "pending-2"]);
  });

  it("puts 'aprovado' cards under 'resolved'", () => {
    expect(groups.resolved.map((r) => r.id)).toEqual(["done-1"]);
  });

  it("excludes cards from other columns entirely (revisao, concluido/Publicado)", () => {
    const all = [...groups.pending, ...groups.resolved];
    expect(all.some((r) => r.id === "revisao-1")).toBe(false);
    expect(all.some((r) => r.id === "publicado-1")).toBe(false);
  });
});

describe("filterByClient", () => {
  const rows = [
    { id: "a", clientSlug: "karpinski" },
    { id: "b", clientSlug: "baita-conveniencia" },
  ];

  it("returns everything when no client is selected ('Todos')", () => {
    expect(filterByClient(rows, "").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("filters down to the selected client", () => {
    expect(filterByClient(rows, "karpinski").map((r) => r.id)).toEqual(["a"]);
  });
});
