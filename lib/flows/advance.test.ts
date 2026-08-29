import { describe, expect, it } from "vitest";
import { advanceFlow, justCompleted, nextFlowStepCardOf } from "./advance";
import { flowStepTaskId } from "./ids";
import type { AdminClient } from "@/lib/automations/taskAccess";
import type { TaskRecord } from "@/lib/validation";

// Cliente Supabase mínimo em memória: só as cadeias que advance.ts usa.
// Um fake basta porque as regras que interessam — "o segundo disparo não cria
// um segundo card" e "um roteiro compartilhado avança as duas entregas" —
// dependem do slot ocupado e do id determinístico, não do Postgres.
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
        not: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
        update(patch: Row) {
          return {
            eq: (col: string, value: unknown) => {
              for (const row of tables[table] ?? []) if (row[col] === value) Object.assign(row, patch);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        insert(fields: Row) {
          const key = table === "task_links" ? ["parent_id", "child_id"] : ["id"];
          const exists = (tables[table] ?? []).some((r) => key.every((k) => r[k] === fields[k]));
          const result = exists
            ? { data: null, error: { code: "23505", message: "duplicate key" } }
            : { data: [fields], error: null };
          if (!exists) { tables[table] = [...(tables[table] ?? []), fields]; inserts.push(fields); }
          return Object.assign(Promise.resolve(result), {
            select: () => ({ limit: () => Promise.resolve(result) }),
          });
        },
      };
      return chain;
    },
  };
  return { admin: api as unknown as AdminClient, inserts };
}

const TYPE_ROWS: Row[] = [
  { id: "t1", parent_id: null, key: "criativo", label: "Criativo", order_index: 20, behavior: "entrega", creatable: true, active: true, lead_days: 0, progress_weight: 1, default_assignee: null, client_visible: false },
  { id: "s1", parent_id: "t1", key: "roteiro", label: "Roteiro", order_index: 10, behavior: "simples", creatable: true, active: true, lead_days: 2, progress_weight: 1, default_assignee: null, client_visible: false },
  { id: "s2", parent_id: "t1", key: "captacao", label: "Captação", order_index: 20, behavior: "simples", creatable: true, active: true, lead_days: 3, progress_weight: 1, default_assignee: null, client_visible: false },
  { id: "s3", parent_id: "t1", key: "publicacao", label: "Publicação", order_index: 30, behavior: "simples", creatable: true, active: true, lead_days: 1, progress_weight: 1, default_assignee: null, client_visible: true },
];

const base = {
  client_id: "cli", kind: "criativo", subtype: null, title: "Peça", status: "backlog", priority: "media",
  assignee: null, assignee_profile_ids: [], reviewer_id: null, approver_id: null, plan_id: null,
  parents: [], requires_review: false, requires_approval: false, due_date: null, start_date: null,
  end_date: null, scheduled_start_at: null, scheduled_end_at: null, progress_weight: 1, description: null,
  client_visible: false, payload: {}, position: 0, recurrence_cadence: null, recurrence_weekdays: [],
  recurrence_day_of_month: null, created_by: null, created_by_name: null, created_at: "", completed_at: null, updated_at: "",
};

const delivery = (id: string, title: string) =>
  ({ ...base, id, title, payload: { flow_parent: true } }) as TaskRecord;

const doneStep = (id: string, subtype: string) =>
  ({ ...base, id, subtype, status: "aprovado", completed_at: "2026-08-28T12:00:00Z" }) as TaskRecord;

/** Uma entrega, com o roteiro já concluído e ligado. */
function world() {
  return {
    tasks: [delivery("entrega", "Vídeo institucional") as unknown as Row, doneStep("card-roteiro", "roteiro") as unknown as Row],
    task_links: [{ parent_id: "entrega", child_id: "card-roteiro", slot: "roteiro", position: 10 }] as Row[],
    task_types: [...TYPE_ROWS],
  };
}

describe("advanceFlow", () => {
  it("materializa a próxima etapa do tipo e a liga à entrega", async () => {
    const state = world();
    const { admin, inserts } = fakeAdmin(state);
    const outcome = await advanceFlow(admin, doneStep("card-roteiro", "roteiro"));
    expect(outcome.created).toHaveLength(1);
    expect(inserts.find((i) => i.subtype === "captacao")).toMatchObject({ title: "Vídeo institucional — Captação" });
    expect(state.task_links.some((l) => l.child_id === outcome.created[0].id && l.slot === "captacao")).toBe(true);
  });

  // A armadilha central de "card cria o próximo": arrastar para Concluído,
  // voltar e arrastar de novo dispara a cascata duas vezes.
  it("é idempotente: disparar duas vezes cria um card só", async () => {
    const state = world();
    const { admin, inserts } = fakeAdmin(state);
    await advanceFlow(admin, doneStep("card-roteiro", "roteiro"));
    const second = await advanceFlow(admin, doneStep("card-roteiro", "roteiro"));
    expect(second.created).toHaveLength(0);
    expect(inserts.filter((i) => i.subtype === "captacao")).toHaveLength(1);
  });

  // O ponto todo do N:N: o mesmo roteiro serve duas peças, e concluí-lo tem
  // que empurrar as duas — cada uma no seu slot, com o seu próprio id.
  it("avança TODAS as entregas de que a etapa participa", async () => {
    const state = world();
    state.tasks.push(delivery("entrega-2", "Reels promo") as unknown as Row);
    state.task_links.push({ parent_id: "entrega-2", child_id: "card-roteiro", slot: "roteiro", position: 10 });
    const { admin } = fakeAdmin(state);

    const outcome = await advanceFlow(admin, doneStep("card-roteiro", "roteiro"));
    expect(outcome.created.map((t) => t.id).sort()).toEqual(
      [flowStepTaskId("entrega", "captacao"), flowStepTaskId("entrega-2", "captacao")].sort(),
    );
    expect(state.task_links.filter((l) => l.slot === "captacao")).toHaveLength(2);
  });

  // Ligar um card à mão numa etapa é o botão de corrente. Depois disso a
  // cascata não pode criar um segundo card para a mesma etapa.
  it("não cria nada quando o slot seguinte já está ocupado à mão", async () => {
    const state = world();
    state.tasks.push(doneStep("captacao-existente", "captacao") as unknown as Row);
    state.task_links.push({ parent_id: "entrega", child_id: "captacao-existente", slot: "captacao", position: 20 });
    const { admin, inserts } = fakeAdmin(state);
    const outcome = await advanceFlow(admin, doneStep("card-roteiro", "roteiro"));
    expect(outcome.created).toHaveLength(0);
    expect(inserts.filter((i) => i.subtype === "captacao")).toHaveLength(0);
  });

  it("ignora um card que não é etapa de fluxo", async () => {
    const { admin, inserts } = fakeAdmin(world());
    const avulso = { ...base, id: "avulso", completed_at: "2026-08-28T12:00:00Z" } as TaskRecord;
    expect((await advanceFlow(admin, avulso)).created).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("ignora uma etapa que ainda não foi concluída", async () => {
    const { admin, inserts } = fakeAdmin(world());
    const emCurso = { ...doneStep("card-roteiro", "roteiro"), status: "em_producao", completed_at: null } as TaskRecord;
    expect((await advanceFlow(admin, emCurso)).created).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  // Append-only: a etapa seguinte pode já carregar comentários, anexos e a
  // decisão de um revisor. Reabrir a anterior não pode apagar isso.
  it("não remove a próxima etapa quando a anterior é reaberta", async () => {
    const state = world();
    const { admin } = fakeAdmin(state);
    await advanceFlow(admin, doneStep("card-roteiro", "roteiro"));
    const before = state.tasks.length;
    await advanceFlow(admin, { ...doneStep("card-roteiro", "roteiro"), status: "em_producao", completed_at: null } as TaskRecord);
    expect(state.tasks).toHaveLength(before);
  });

  // Ciclo de vida do pai: a entrega fecha sozinha quando a última etapa cai.
  it("encerra a entrega quando todas as etapas do tipo existem e terminaram", async () => {
    const state = world();
    for (const [id, slot] of [["c2", "captacao"], ["c3", "publicacao"]] as const) {
      state.tasks.push(doneStep(id, slot) as unknown as Row);
      state.task_links.push({ parent_id: "entrega", child_id: id, slot, position: 20 });
    }
    const { admin } = fakeAdmin(state);
    const outcome = await advanceFlow(admin, doneStep("c3", "publicacao"));
    expect(outcome.finished).toEqual(["entrega"]);
    // Sem revisor nem aprovador, encerra direto.
    expect(state.tasks.find((t) => t.id === "entrega")?.status).toBe("concluido");
  });
});

describe("nextFlowStepCardOf", () => {
  // É o que a interface usa para oferecer o acesso à próxima etapa no mesmo
  // salvamento que a concluiu; antes disso era preciso fechar e reabrir o card.
  it("devolve a etapa seguinte depois que ela foi materializada", async () => {
    const state = world();
    const { admin } = fakeAdmin(state);
    await advanceFlow(admin, doneStep("card-roteiro", "roteiro"));
    const next = await nextFlowStepCardOf(admin, doneStep("card-roteiro", "roteiro"));
    expect(next?.id).toBe(flowStepTaskId("entrega", "captacao"));
  });

  it("devolve null antes de ela existir e depois da última etapa", async () => {
    const { admin } = fakeAdmin(world());
    expect(await nextFlowStepCardOf(admin, doneStep("card-roteiro", "roteiro"))).toBeNull();
    expect(await nextFlowStepCardOf(admin, doneStep("c3", "publicacao"))).toBeNull();
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
