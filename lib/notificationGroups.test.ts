import { describe, expect, it } from "vitest";
import { groupNotifications } from "./notificationGroups";
import type { NotificationRecord } from "./notificationTypes";

const row = (id: string, extra: Partial<NotificationRecord>): NotificationRecord => ({
  id, profile_id: "p", task_id: "t1", type: "task_review_assigned", message: "Revisão atribuída", read_at: null, created_at: "2026-09-28T10:00:00Z", ...extra,
});

describe("caixa de entrada agrupada", () => {
  it("mesmo card e mesmo tipo viram uma linha, com a mais recente e a contagem", () => {
    const groups = groupNotifications([
      row("a", { created_at: "2026-09-27T10:00:00Z", message: "antiga", read_at: "2026-09-27T11:00:00Z" }),
      row("b", { created_at: "2026-09-28T10:00:00Z", message: "nova", read_at: "2026-09-28T11:00:00Z" }),
      row("c", { created_at: "2026-09-26T10:00:00Z", read_at: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "b", message: "nova", count: 3, ids: ["b", "a", "c"], read_at: null });
  });

  it("tipos diferentes e avisos sem card ficam separados, do mais novo ao mais antigo", () => {
    const groups = groupNotifications([
      row("a", { type: "task_commented", created_at: "2026-09-28T09:00:00Z" }),
      row("b", { created_at: "2026-09-28T08:00:00Z" }),
      row("c", { task_id: null, created_at: "2026-09-28T12:00:00Z" }),
      row("d", { task_id: null, created_at: "2026-09-28T07:00:00Z" }),
    ]);
    expect(groups.map((group) => group.id)).toEqual(["c", "a", "b", "d"]);
    expect(groups.every((group) => group.count === 1)).toBe(true);
  });
});
