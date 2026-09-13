import { describe, expect, it } from "vitest";
import { flowCommentTargetId } from "./commentTarget";
import type { AdminClient } from "@/lib/automations/taskAccess";
import type { TaskRecord } from "@/lib/validation";

// Um client de serviço de mentira, só com a cadeia que commentTarget usa:
// task_links.select().eq().not(), tasks.select().in() e
// task_assignees.select().in(). Fake em vez de mock de módulo porque o que
// importa aqui é a REGRA (qual card recebe o comentário), não como o
// supabase-js encadeia — e um fake explícito falha se a consulta mudar de
// forma, que é exatamente o alarme que se quer.
function fakeAdmin(
  links: { child_id: string; slot: string | null; position: number | null }[],
  tasks: Record<string, unknown>[],
  taskAssignees: { task_id: string; profile_id: string }[] = [],
): AdminClient {
  const linksQuery = {
    select: () => linksQuery,
    eq: () => linksQuery,
    not: () => Promise.resolve({ data: links, error: null }),
  };
  const tasksQuery = {
    select: () => tasksQuery,
    in: () => Promise.resolve({ data: tasks, error: null }),
  };
  const assigneesQuery = {
    select: () => assigneesQuery,
    in: () => Promise.resolve({ data: taskAssignees, error: null }),
  };
  return {
    from: (table: string) => {
      if (table === "task_links") return linksQuery;
      if (table === "task_assignees") return assigneesQuery;
      return tasksQuery;
    },
  } as unknown as AdminClient;
}

const delivery = (id = "entrega"): TaskRecord =>
  ({ id, kind: "criativo", payload: { flow_parent: true } }) as unknown as TaskRecord;

const step = (
  id: string,
  completed: string | null,
  extra: { reviewer_id?: string | null; status?: string } = {},
) => ({ id, kind: "criativo", payload: {}, completed_at: completed, reviewer_id: extra.reviewer_id ?? null, status: extra.status ?? "em_producao" });

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

// O caso real que motivou a regra de papel: captação ainda aberta (mais
// antiga por posição) enquanto edição, mais adiante, já está em revisão com
// revisor próprio. Sem a regra de papel, o comentário do revisor cairia em
// captação — o card errado.
describe("flowCommentTargetId — precedência de papel por cima da corrente por posição", () => {
  const links = [
    { child_id: "captacao", slot: "captacao", position: 20 },
    { child_id: "edicao", slot: "edicao", position: 30 },
  ];

  it("revisor de uma etapa em revisão vence, mesmo com uma etapa anterior ainda aberta", async () => {
    const tasks = [step("captacao", null), step("edicao", null, { status: "revisao", reviewer_id: "allan" })];
    const admin = fakeAdmin(links, tasks);
    expect(await flowCommentTargetId(admin, delivery(), "allan")).toBe("edicao");
  });

  it("sem etapa em revisão: quem comentou cai como responsável vinculado de uma etapa aberta", async () => {
    const tasks = [step("captacao", null), step("edicao", null)];
    const admin = fakeAdmin(links, tasks, [{ task_id: "edicao", profile_id: "allan" }]);
    expect(await flowCommentTargetId(admin, delivery(), "allan")).toBe("edicao");
  });

  it("revisor de uma etapa E responsável de outra: o papel de revisor vence", async () => {
    const tasks = [
      step("captacao", null, { status: "em_producao" }),
      step("edicao", null, { status: "revisao", reviewer_id: "allan" }),
    ];
    const admin = fakeAdmin(links, tasks, [{ task_id: "captacao", profile_id: "allan" }]);
    expect(await flowCommentTargetId(admin, delivery(), "allan")).toBe("edicao");
  });

  it("nenhum papel em etapa nenhuma: cai no fallback de sempre (a mais antiga aberta)", async () => {
    const tasks = [step("captacao", null), step("edicao", null, { status: "revisao", reviewer_id: "outra-pessoa" })];
    const admin = fakeAdmin(links, tasks);
    expect(await flowCommentTargetId(admin, delivery(), "allan")).toBe("captacao");
  });

  it("commenterId nulo (não informado): cai no fallback de sempre, sem consultar papéis", async () => {
    const tasks = [step("captacao", null), step("edicao", null, { status: "revisao", reviewer_id: "allan" })];
    const admin = fakeAdmin(links, tasks);
    expect(await flowCommentTargetId(admin, delivery())).toBe("captacao");
  });

  it("responsável só por nome livre (sem task_assignees) nunca aciona a regra de papel", async () => {
    // "allan" aparece como texto no assignee (fora do escopo deste módulo,
    // que só lê task_assignees) — sem vínculo estruturado, cai no fallback.
    const tasks = [step("captacao", null), step("edicao", null)];
    const admin = fakeAdmin(links, tasks, []);
    expect(await flowCommentTargetId(admin, delivery(), "allan")).toBe("captacao");
  });
});
