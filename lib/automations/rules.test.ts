import { describe, expect, it } from "vitest";
import { ruleDefinitionSchema } from "./rules";
import { occurrenceEventKey, statusEventKey } from "./ruleEngine";

const UUID = "10000000-0000-4000-8000-000000000001";
const SUBTYPE = "10000000-0000-4000-8000-000000000002";
const VERSION = "10000000-0000-4000-8000-000000000003";
const STEP = "10000000-0000-4000-8000-000000000004";
const base = {
  sourceTypeId: UUID, sourceSubtypeId: SUBTYPE,
  workflowVersionId: VERSION, workflowStepId: STEP,
  triggerKind: "status_transition", fromStatus: "backlog", toStatus: "em_producao",
  actionKind: "create_card", actionConfig: { title: "Próxima tarefa" },
  outputTypeId: UUID, outputSubtypeId: SUBTYPE,
};

describe("published rule definition", () => {
  it("keeps canonical Type, Subtype, workflow version and step identifiers", () => {
    const value = ruleDefinitionSchema.parse(base);
    expect([value.sourceTypeId, value.sourceSubtypeId, value.workflowVersionId, value.workflowStepId])
      .toEqual([UUID, SUBTYPE, VERSION, STEP]);
  });
  it("rejects a workflow step without its version and an incomplete transition", () => {
    expect(ruleDefinitionSchema.safeParse({ ...base, workflowVersionId: null }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...base, toStatus: null }).success).toBe(false);
  });
  it("requires the recurrence occurrence trigger for daily and report executors", () => {
    expect(ruleDefinitionSchema.safeParse({ ...base, actionKind: "report", actionConfig: { automationKey: "relatorio_conversao" } }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...base, triggerKind: "recurrence_occurrence", fromStatus: null, toStatus: null,
      actionKind: "report", actionConfig: { automationKey: "relatorio_conversao" } }).success).toBe(true);
  });
});

describe("event idempotency keys", () => {
  it("retries use the same key while a new occurrence or transition uses another", () => {
    const a = occurrenceEventKey(VERSION, UUID, "2026-09-27");
    expect(occurrenceEventKey(VERSION, UUID, "2026-09-27")).toBe(a);
    expect(occurrenceEventKey(VERSION, UUID, "2026-09-28")).not.toBe(a);
    const status = statusEventKey(VERSION, UUID, "backlog", "em_producao", "2026-09-27T14:00:00Z");
    expect(statusEventKey(VERSION, UUID, "backlog", "em_producao", "2026-09-27T14:00:00Z")).toBe(status);
    expect(statusEventKey(VERSION, UUID, "revisao", "aprovado", "2026-09-27T14:01:00Z")).not.toBe(status);
  });
});
