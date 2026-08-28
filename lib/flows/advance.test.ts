import { describe, expect, it } from "vitest";
import { advanceFlow, justCompleted, nextFlowStepCardOf } from "./advance";
import { flowStepTaskId } from "./ids";
import type { AdminClient } from "@/lib/automations/taskAccess";
import type { TaskRecord } from "@/lib/validation";

// Cliente Supabase mínimo em memória: só as cadeias que advance.ts usa
// (select/eq/in/limit e insert com colisão de chave primária). Um fake é
// suficiente porque a regra que interessa aqui — "o segundo disparo não cria
// um segundo card" — depende só do id determinístico e do 23505.
type Row = Record<string, unknown>;

function fakeAdmin(tables: Record<string, Row[]>) {
  const inserts: Row[] = [];
  const api = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const chain = {
        select: () => chain,
        eq: (col: string, value: unknown) => { rows = rows.filter((r) => r[col] === value); return chain; },
        in: (col: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[col])); return chain; },
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
        insert(fields: Row) {
          const existing = (tables[table] ?? []).some((r) => r.id === fields.id);
          const result = existing
            ? { data: null, error: { code: "23505", message: "duplicate key" } }
            : { data: [fields], error: null };
          if (!existing) { tables[table] = [...(tables[table] ?? []), fields]; inserts.push(fields); }
          return { select: () => ({ limit: () => Promise.resolve(result) }) };
        },
      };
      return chain;
    },
  };
  return { admin: api as unknown as AdminClient, inserts };
}

const TEMPLATE = { id: "tpl", name: "Criativo", description: null, active: true };
const STEPS = [
  { id: "s1", template_id: "tpl", step_key: "roteiro", order_index: 10, title: "Roteiro", kind: "criativo", subtype: "roteiro", lead_days: 2, progress_weight: 1, default_assignee: null, client_visible: false },
  { id: "s2", template_id: "tpl", step_key: "captacao", order_index: 20, title: "Captação", kind: "criativo", subtype: "captacao", lead_days: 3, progress_weight: 1, default_assignee: null, client_visible: false },
  { id: "s3", template_id: "tpl", step_key: "publicacao", order_index: 30, title: "Publicação", kind: "criativo", subtype: "publicacao", lead_days: 1, progress_weight: 1, default_assignee: null, client_visible: true },
];

const base = {
  client_id: "cli", kind: "criativo", subtype: null, title: "Peça", status: "backlog", priority: "media",
  assignee: null, assignee_profile_ids: [], reviewer_id: null, approver_id: null, plan_id: null,
  flow_template_id: null, requires_review: false, requires_approval: false, due_date: null, start_date: null,
  end_date: null, scheduled_start_at: null, scheduled_end_at: null, progress_weight: 1, description: null,
  client_visible: false, payload: {}, position: 0, recurrence_cadence: null, recurrence_weekdays: [],
  recurrence_day_of_month: null, created_by: null, created_by_name: null, created_at: "", completed_at: null, updated_at: "",
};

const delivery = { ...base, id: "entrega", title: "Vídeo institucional", flow_template_id: "tpl" } as TaskRecord;
const doneStep = (stepKey: string) =>
  ({ ...base, id: `card-${stepKey}`, plan_id: "entrega", payload: { flow_step_key: stepKey }, status: "aprovado", completed_at: "2026-08-28T12:00:00Z" }) as TaskRecord;

function world() {
  return { tasks: [delivery as unknown as Row, doneStep("roteiro") as unknown as Row], task_flow_templates: [TEMPLATE], task_flow_steps: [...STEPS] };
}

describe("advanceFlow", () => {
  it("materializa a próxima etapa do molde", async () => {
    const { admin, inserts } = fakeAdmin(world());
    const outcome = await advanceFlow(admin, doneStep("roteiro"));
    expect(outcome.status).toBe("created");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ subtype: "captacao", plan_id: "entrega", title: "Vídeo institucional — Captação" });
  });

  // A armadilha central de "card cria o próximo": arrastar para Concluído,
  // voltar e arrastar de novo dispara a cascata duas vezes. Índice único sobre
  // um campo editável (data) não pegaria isso — o id determinístico pega.
  it("é idempotente: disparar duas vezes cria um card só", async () => {
    const state = world();
    const { admin, inserts } = fakeAdmin(state);
    await advanceFlow(admin, doneStep("roteiro"));
    const second = await advanceFlow(admin, doneStep("roteiro"));
    expect(second).toEqual({ status: "already_exists", taskId: flowStepTaskId("entrega", "captacao") });
    expect(inserts).toHaveLength(1);
  });

  it("não cria nada depois da última etapa", async () => {
    const state = world();
    state.tasks.push(doneStep("publicacao") as unknown as Row);
    const { admin, inserts } = fakeAdmin(state);
    expect(await advanceFlow(admin, doneStep("publicacao"))).toEqual({ status: "flow_finished" });
    expect(inserts).toHaveLength(0);
  });

  it("ignora um card que não é etapa de fluxo", async () => {
    const { admin, inserts } = fakeAdmin(world());
    const avulso = { ...base, id: "avulso", completed_at: "2026-08-28T12:00:00Z" } as TaskRecord;
    expect(await advanceFlow(admin, avulso)).toEqual({ status: "not_a_flow_step" });
    expect(inserts).toHaveLength(0);
  });

  it("ignora uma etapa que ainda não foi concluída", async () => {
    const { admin, inserts } = fakeAdmin(world());
    const emCurso = { ...doneStep("roteiro"), status: "em_producao", completed_at: null } as TaskRecord;
    expect(await advanceFlow(admin, emCurso)).toEqual({ status: "not_completed" });
    expect(inserts).toHaveLength(0);
  });

  // Append-only: a etapa seguinte pode já carregar comentários, anexos e a
  // decisão de um revisor. Reabrir a anterior não pode apagar isso.
  it("não remove a próxima etapa quando a anterior é reaberta", async () => {
    const state = world();
    const { admin } = fakeAdmin(state);
    await advanceFlow(admin, doneStep("roteiro"));
    const before = state.tasks.length;
    const reaberta = { ...doneStep("roteiro"), status: "em_producao", completed_at: null } as TaskRecord;
    await advanceFlow(admin, reaberta);
    expect(state.tasks).toHaveLength(before);
  });
});

describe("nextFlowStepCardOf", () => {
  // É o que a interface usa para oferecer o acesso à próxima etapa no mesmo
  // salvamento que a concluiu; antes disso era preciso fechar e reabrir o card.
  it("devolve a etapa seguinte depois que ela foi materializada", async () => {
    const state = world();
    const { admin } = fakeAdmin(state);
    await advanceFlow(admin, doneStep("roteiro"));
    const next = await nextFlowStepCardOf(admin, doneStep("roteiro"));
    expect(next?.id).toBe(flowStepTaskId("entrega", "captacao"));
  });

  it("devolve null antes de ela existir e depois da última etapa", async () => {
    const { admin } = fakeAdmin(world());
    expect(await nextFlowStepCardOf(admin, doneStep("roteiro"))).toBeNull();
    expect(await nextFlowStepCardOf(admin, doneStep("publicacao"))).toBeNull();
  });
});

describe("justCompleted", () => {
  it("dispara na transição, não em toda gravação de um card já concluído", () => {
    expect(justCompleted({ completed_at: null }, { completed_at: "2026-08-28T12:00:00Z" })).toBe(true);
    expect(justCompleted({ completed_at: "2026-08-27T12:00:00Z" }, { completed_at: "2026-08-28T12:00:00Z" })).toBe(false);
    expect(justCompleted({ completed_at: "2026-08-27T12:00:00Z" }, { completed_at: null })).toBe(false);
    expect(justCompleted({ completed_at: null }, { completed_at: null })).toBe(false);
  });
});
