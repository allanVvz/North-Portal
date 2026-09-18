import { describe, expect, it } from "vitest";
import { createFakeTaskDb } from "./fakeTaskDb";

// O fake só vale se reproduzir o que o banco faz. Estes testes fixam o trigger que
// já enganou este código: escrever `status` direto numa Entrega é recusado, e o
// status dela é a projeção do primeiro passo aberto.

const link = (parent: string, child: string, position: number) => ({ parent_id: parent, child_id: child, relation_kind: "workflow_step", workflow_step_id: `ws-${position}`, position });

function delivery() {
  return createFakeTaskDb({
    tasks: [
      { id: "entrega", workflow_version_id: "wv", status: "backlog", payload: {} },
      { id: "a", status: "backlog", payload: {} },
      { id: "b", status: "backlog", payload: {} },
    ],
    task_links: [link("entrega", "a", 10), link("entrega", "b", 20)],
  });
}

describe("FakeTaskDb — trigger de projeção do status do pai", () => {
  it("recusa escrita direta de status numa Entrega (23514) e não altera nada", async () => {
    const db = delivery();
    const result = await db.from("tasks").update({ status: "em_producao" }).eq("id", "entrega");
    expect(result.error?.code).toBe("23514");
    expect(db.task("entrega")!.status).toBe("backlog");
  });

  it("recusa também no molde recorrente e no Plano de Ação", async () => {
    const db = createFakeTaskDb({ tasks: [
      { id: "molde", recurrence_cadence: "semanal", status: "backlog", payload: {} },
      { id: "plano", kind: "plano_acao", status: "backlog", payload: {} },
    ] });
    expect((await db.from("tasks").update({ status: "parada" }).eq("id", "molde")).error?.code).toBe("23514");
    expect((await db.from("tasks").update({ status: "parada" }).eq("id", "plano")).error?.code).toBe("23514");
  });

  it("gravar o MESMO status não é mudança (o trigger só olha `is distinct from`)", async () => {
    const db = delivery();
    expect((await db.from("tasks").update({ status: "backlog" }).eq("id", "entrega")).error).toBeNull();
  });

  it("colunas que não são status continuam graváveis no pai", async () => {
    const db = delivery();
    expect((await db.from("tasks").update({ due_date: "2026-09-28" }).eq("id", "entrega")).error).toBeNull();
    expect(db.task("entrega")!.due_date).toBe("2026-09-28");
  });

  it("card comum muda de status livremente", async () => {
    const db = delivery();
    expect((await db.from("tasks").update({ status: "em_producao" }).eq("id", "a")).error).toBeNull();
  });

  it("o status da Entrega acompanha o primeiro passo aberto, na ordem", async () => {
    const db = delivery();
    await db.from("tasks").update({ status: "em_producao" }).eq("id", "a");
    expect(db.task("entrega")!.status).toBe("em_producao");

    await db.from("tasks").update({ status: "aprovado" }).eq("id", "a");
    // `a` concluiu; o passo aberto agora é `b` (ainda em Entrada).
    expect(db.task("entrega")!.status).toBe("backlog");

    await db.from("tasks").update({ status: "revisao" }).eq("id", "b");
    expect(db.task("entrega")!.status).toBe("revisao");

    await db.from("tasks").update({ status: "aprovado" }).eq("id", "b");
    expect(db.task("entrega")!.status).toBe("aprovado");
    expect(db.task("entrega")!.completed_at).toBeTruthy();
  });
});
