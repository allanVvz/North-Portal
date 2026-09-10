import { describe, expect, it } from "vitest";
import { flowCommentTargetId } from "./commentTarget";
import type { AdminClient } from "@/lib/automations/taskAccess";
import type { TaskRecord } from "@/lib/validation";

// Um client de serviço de mentira, só com a cadeia que commentTarget usa:
// task_links.select().eq().not() e tasks.select().in(). Fake em vez de mock de
// módulo porque o que importa aqui é a REGRA (qual card recebe o comentário),
// não como o supabase-js encadeia — e um fake explícito falha se a consulta
// mudar de forma, que é exatamente o alarme que se quer.
function fakeAdmin(links: { child_id: string; slot: string | null; position: number | null }[], tasks: Record<string, unknown>[]): AdminClient {
  const linksQuery = {
    select: () => linksQuery,
    eq: () => linksQuery,
    not: () => Promise.resolve({ data: links, error: null }),
  };
  const tasksQuery = {
    select: () => tasksQuery,
    in: () => Promise.resolve({ data: tasks, error: null }),
  };
  return { from: (table: string) => (table === "task_links" ? linksQuery : tasksQuery) } as unknown as AdminClient;
}

const delivery = (id = "entrega"): TaskRecord =>
  ({ id, kind: "criativo", payload: { flow_parent: true } }) as unknown as TaskRecord;

const step = (id: string, completed: string | null) => ({ id, kind: "criativo", payload: {}, completed_at: completed });

describe("flowCommentTargetId — onde um comentário no card pai é gravado", () => {
  it("desvia para a primeira etapa ainda aberta", async () => {
    const admin = fakeAdmin(
      [
        { child_id: "roteiro", slot: "roteiro", position: 10 },
        { child_id: "captacao", slot: "captacao", position: 20 },
      ],
      [step("roteiro", "2026-09-01T00:00:00Z"), step("captacao", null)],
    );
    expect(await flowCommentTargetId(admin, delivery())).toBe("captacao");
  });

  // A ordem tem que vir do `position` do ELO, não da ordem em que o banco
  // devolveu as linhas — é o mesmo erro que já pôs a etapa de edição como 1/4
  // em produção (ver stepOrderOf).
  it("ordena pela posição do elo, não pela ordem de retorno da consulta", async () => {
    const admin = fakeAdmin(
      [
        { child_id: "edicao", slot: "edicao", position: 30 },
        { child_id: "roteiro", slot: "roteiro", position: 10 },
      ],
      [step("edicao", null), step("roteiro", null)],
    );
    expect(await flowCommentTargetId(admin, delivery())).toBe("roteiro");
  });

  it("cai na última etapa quando a corrente inteira terminou", async () => {
    const admin = fakeAdmin(
      [
        { child_id: "roteiro", slot: "roteiro", position: 10 },
        { child_id: "publicacao", slot: "publicacao", position: 40 },
      ],
      [step("roteiro", "2026-09-01T00:00:00Z"), step("publicacao", "2026-09-02T00:00:00Z")],
    );
    expect(await flowCommentTargetId(admin, delivery())).toBe("publicacao");
  });

  it("fica na própria entrega quando ela ainda não tem etapa nenhuma", async () => {
    expect(await flowCommentTargetId(fakeAdmin([], []), delivery("vazia"))).toBe("vazia");
  });

  // Plano de Ação e card comum não têm "etapa corrente" — a regra é só de
  // entrega, e o comentário continua onde foi escrito.
  it("não desvia um card que não é entrega", async () => {
    const plano = { id: "plano", kind: "plano_acao", payload: {} } as unknown as TaskRecord;
    expect(await flowCommentTargetId(fakeAdmin([], []), plano)).toBe("plano");
  });
});
