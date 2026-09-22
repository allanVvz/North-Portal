import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";
import type { TaskRecord } from "@/lib/validation";

// A porta única de aprovação. O que se prova: o compare-and-set e a cascata andam
// SEMPRE juntos, e uma aprovação atrasada nunca reabre o que já foi concluído.

const cascata = vi.hoisted(() => vi.fn(async (_before: unknown, _after: unknown, _actorId?: unknown) => undefined));
vi.mock("./advance", () => ({ advanceFlowAfterUpdate: cascata }));

import { approveTask, APPROVABLE_FROM } from "./approve";

const ETAPA = "etapa-1";
const asRecord = (row: Row | undefined) => row as unknown as TaskRecord;

function seed(status: string, over: Partial<Row> = {}): FakeTaskDb {
  return createFakeTaskDb({
    tasks: [{ id: ETAPA, client_id: "cli", kind: "operacional", subtype: "relatorio_anuncios", title: "Relatório de anúncios", status, payload: {}, ...over }],
  });
}

beforeEach(() => cascata.mockClear());

describe("approveTask", () => {
  it("aprova e dispara a cascata, na mesma chamada", async () => {
    const db = seed("revisao");
    const antes = asRecord(db.task(ETAPA));

    const depois = await approveTask(db.asAdmin(), antes, { actorId: "u1" });

    expect(depois?.status).toBe("aprovado");
    expect(db.task(ETAPA)!.status).toBe("aprovado");
    expect(cascata).toHaveBeenCalledTimes(1);
    // O ator é repassado: a cascata usa para não notificar quem acabou de agir.
    expect(cascata.mock.calls[0][2]).toBe("u1");
  });

  it("todo estado aberto é aprovável", async () => {
    for (const status of APPROVABLE_FROM) {
      const db = seed(status);
      const r = await approveTask(db.asAdmin(), asRecord(db.task(ETAPA)));
      expect(r?.status, status).toBe("aprovado");
    }
  });

  it("tarefa já concluída não é reaberta, e a cascata NÃO roda", async () => {
    // Uma aprovação atrasada (comentário antigo, retry) não pode desfazer nada.
    const db = seed("aprovado", { completed_at: "2026-09-20T10:00:00Z" });
    const r = await approveTask(db.asAdmin(), asRecord(db.task(ETAPA)));

    expect(r).toBeNull();
    expect(cascata).not.toHaveBeenCalled();
  });

  it("estado fora da origem permitida devolve null sem tocar na tarefa", async () => {
    const db = seed("parada");
    const r = await approveTask(db.asAdmin(), asRecord(db.task(ETAPA)), { from: ["revisao"] });

    expect(r).toBeNull();
    expect(db.task(ETAPA)!.status).toBe("parada");
    expect(cascata).not.toHaveBeenCalled();
  });

  it("null é 'alguém chegou antes', não erro", async () => {
    const db = seed("revisao");
    const antes = asRecord(db.task(ETAPA));

    expect(await approveTask(db.asAdmin(), antes)).not.toBeNull();
    // Segunda chamada com a mesma leitura antiga: a tarefa já está aprovada.
    expect(await approveTask(db.asAdmin(), antes)).toBeNull();
    expect(cascata).toHaveBeenCalledTimes(1);
  });
});
