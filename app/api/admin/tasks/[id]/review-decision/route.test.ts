import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), task: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Card", subtype: undefined as string | undefined, parents: [] as Array<{ id: string; relation_kind: string }> } }));
vi.mock("@/lib/supabase/auth", () => ({ requireAdmin: async () => ({ userId: "reviewer-1" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/automations/taskAccess", () => ({ asTaskRecord: (task: unknown) => task, getAdminTask: async () => state.task }));
vi.mock("@/lib/flows/advance", () => ({ advanceDeliveryForStep: vi.fn(), advanceFlowAfterUpdate: vi.fn() }));
vi.mock("@/lib/creativeDriveSync", () => ({ returnEditFinalsToPreview: vi.fn() }));

import { POST } from "./route";
import { returnEditFinalsToPreview } from "@/lib/creativeDriveSync";

const TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DELIVERY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function request(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/admin/tasks/${TASK_ID}/review-decision`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("review decision route", () => {
  beforeEach(() => { state.rpc.mockReset(); state.task.subtype = undefined; state.task.parents = []; vi.mocked(returnEditFinalsToPreview).mockReset(); });

  it("encaminha decisão autorizada e justificativa vazia como opcional", async () => {
    state.rpc.mockResolvedValue({ data: { task: { id: TASK_ID }, effective_status: "aprovado", decision: "approve", event_id: REQUEST_ID, replayed: false }, error: null });
    const response = await POST(request({ decision: "approve", justification: "  ", request_id: REQUEST_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("decide_task_review", expect.objectContaining({
      p_task_id: TASK_ID, p_actor_id: "reviewer-1", p_decision: "approve", p_justification: null,
      p_expected_status: "revisao", p_request_id: REQUEST_ID, p_actor_kind: "human",
    }));
  });

  it("rejeita pessoa que não está entre os revisores", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Actor is not an assigned reviewer" } });
    const response = await POST(request({ decision: "request_changes", justification: "Ajustar o título", request_id: REQUEST_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    expect(response.status).toBe(403);
  });

  it("mantém resposta idempotente do banco em retry", async () => {
    state.rpc.mockResolvedValue({ data: { task: { id: TASK_ID }, effective_status: "em_producao", decision: "request_changes", event_id: REQUEST_ID, replayed: true }, error: null });
    const response = await POST(request({ decision: "request_changes", request_id: REQUEST_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ event_id: REQUEST_ID, replayed: true });
  });

  it("mantém a decisão no vínculo da Entrega escolhida", async () => {
    state.rpc.mockResolvedValue({ data: { task: { id: TASK_ID }, effective_status: "aprovado", decision: "approve", event_id: REQUEST_ID, replayed: false }, error: null });
    const response = await POST(request({ decision: "approve", delivery_id: DELIVERY_ID, request_id: REQUEST_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("decide_task_review", expect.objectContaining({ p_delivery_id: DELIVERY_ID }));
  });

  it("ao pedir ajustes na Edição, devolve os finais da Entrega escolhida para Preview apenas uma vez", async () => {
    state.task.subtype = "edicao";
    state.task.parents = [{ id: DELIVERY_ID, relation_kind: "workflow_step" }];
    state.rpc.mockResolvedValue({ data: { task: { id: TASK_ID, title: "Card" }, effective_status: "em_producao", decision: "request_changes", event_id: REQUEST_ID, replayed: false }, error: null });
    const response = await POST(request({ decision: "request_changes", delivery_id: DELIVERY_ID, request_id: REQUEST_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    expect(response.status).toBe(200);
    expect(returnEditFinalsToPreview).toHaveBeenCalledWith(expect.anything(), TASK_ID, [DELIVERY_ID]);
    vi.mocked(returnEditFinalsToPreview).mockClear();
    state.rpc.mockResolvedValue({ data: { task: { id: TASK_ID, title: "Card" }, effective_status: "em_producao", decision: "request_changes", event_id: REQUEST_ID, replayed: true }, error: null });
    await POST(request({ decision: "request_changes", delivery_id: DELIVERY_ID, request_id: REQUEST_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    expect(returnEditFinalsToPreview).not.toHaveBeenCalled();
  });

  it("pede atualização quando o status esperado deixou de ser Revisão", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Review status changed" } });
    const response = await POST(request({ decision: "approve", request_id: REQUEST_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    expect(response.status).toBe(409);
  });
});
