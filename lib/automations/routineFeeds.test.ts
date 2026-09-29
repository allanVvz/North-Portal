import { describe, expect, it, vi } from "vitest";
import { feedsOf, foldFeeds } from "./routineFeeds";
import { normalizeOperationItems } from "@/app/admin/operacao/operationItems";
import type { RecurringTask } from "@/lib/supabase";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const routine = (id: string, next: string | null) => ({
  id, title: id, kind: "operacional", subtype: null, status: "backlog", priority: "media", assignee: null, payload: {}, parents: [],
  recurrence_cadence: "semanal", next_due_date: next, due_date: next, executions: [], clientName: "Cris", clientSlug: "cris",
}) as unknown as RecurringTask;

const configs = [
  { id: "ads", automation_key: "relatorio_trafego_semanal", target_task_id: "molde-anuncios", depends_on_config_id: null },
  { id: "conv", automation_key: "relatorio_conversao", target_task_id: "molde-entrega", depends_on_config_id: "ads" },
];

describe("os dois moldes de uma automação de relatório viram uma rotina", () => {
  it("liga o molde de anúncios ao da Entrega pela dependência declarada", () => {
    expect([...feedsOf(configs)]).toEqual([["molde-anuncios", "molde-entrega"]]);
  });

  it("a rotina da Entrega fica, com a próxima data do molde de anúncios; a de anúncios some", () => {
    // O molde da Entrega ficava parado em 22/09 e aparecia "Atrasada".
    const folded = foldFeeds([routine("molde-anuncios", "2026-10-05"), routine("molde-entrega", "2026-09-22")], feedsOf(configs));
    expect(folded.find((r) => r.id === "molde-entrega")!.next_due_date).toBe("2026-10-05");
    expect(normalizeOperationItems([], folded).map((item) => item.id)).toEqual(["molde-entrega"]);
  });

  it("sem o molde da Entrega na lista, o de anúncios continua aparecendo", () => {
    const folded = foldFeeds([routine("molde-anuncios", "2026-10-05")], feedsOf(configs));
    expect(normalizeOperationItems([], folded).map((item) => item.id)).toEqual(["molde-anuncios"]);
  });
});
