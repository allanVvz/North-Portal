import { describe, expect, it } from "vitest";
import { COMMENT_STAGE_AMBIGUOUS, COMMENT_STAGE_INVALID, flowCommentTargetId, resolveFlowCommentTarget } from "./commentTarget";
import { HttpError } from "@/lib/validation";
import type { AdminClient } from "@/lib/automations/taskAccess";
import type { TaskRecord } from "@/lib/validation";

// Um client de serviço de mentira, só com a cadeia que commentTarget usa:
// task_links.select().eq().not(), tasks.select().in() e
// task_assignees.select().in(). Fake em vez de mock de módulo porque o que
// importa aqui é a REGRA (qual card recebe o comentário), não como o
// supabase-js encadeia — e um fake explícito falha se a consulta mudar de
// forma, que é exatamente o alarme que se quer.
function fakeAdmin(
  links: { child_id: string; slot: string | null; position: number | null; status_override?: TaskRecord["status"] | null; completed_at_override?: string | null }[],
  tasks: Record<string, unknown>[],
  taskAssignees: { task_id: string; profile_id: string }[] = [],
): AdminClient {
  const linksQuery = {
    select: () => linksQuery,
    eq: () => linksQuery,
    then: (resolve: (result: { data: typeof links; error: null }) => unknown) => resolve({ data: links, error: null }),
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
  ({ id, kind: "criativo", payload: {}, workflow_version_id: "workflow-v1" }) as unknown as TaskRecord;

const step = (
  id: string,
  completed: string | null,
  extra: { reviewer_id?: string | null; status?: string } = {},
) => ({ id, kind: "criativo", payload: {}, completed_at: completed, reviewer_id: extra.reviewer_id ?? null, status: extra.status ?? "em_producao" });

async function expectAmbiguous(promise: Promise<unknown>, candidates: string[]) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  const http = error as HttpError;
  expect(http.status).toBe(409);
  expect(http.details?.code).toBe(COMMENT_STAGE_AMBIGUOUS);
  expect([...(http.details?.candidates as string[])].sort()).toEqual([...candidates].sort());
}

describe("flowCommentTargetId — onde um comentário no card pai é gravado", () => {
  it("usa o status desta Entrega ao escolher a etapa, sem confundir o card compartilhado", async () => {
    const admin = fakeAdmin(
      [
        { child_id: "roteiro", slot: "roteiro", position: 10, status_override: "aprovado", completed_at_override: "2026-09-25T12:00:00Z" },
        { child_id: "captacao", slot: "captacao", position: 20 },
      ],
      [step("roteiro", null, { status: "backlog" }), step("captacao", null)],
    );
    expect(await flowCommentTargetId(admin, delivery())).toBe("captacao");
  });
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
    // Tudo concluído: o destino é a ÚLTIMA da corrente — e "última" é a de maior
    // posição no elo, mesmo que a consulta devolva a linha dela primeiro.
    const admin = fakeAdmin(
      [
        { child_id: "roteiro", slot: "roteiro", position: 10 },
        { child_id: "publicacao", slot: "publicacao", position: 40 },
      ],
      [step("publicacao", "2026-09-02T00:00:00Z"), step("roteiro", "2026-09-01T00:00:00Z")],
    );
    expect(await flowCommentTargetId(admin, delivery())).toBe("publicacao");
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

  it("nenhum papel em etapa nenhuma: ambíguo, 409 com os candidatos (nunca um palpite)", async () => {
    const tasks = [step("captacao", null), step("edicao", null, { status: "revisao", reviewer_id: "outra-pessoa" })];
    const admin = fakeAdmin(links, tasks);
    await expectAmbiguous(flowCommentTargetId(admin, delivery(), "allan"), ["captacao", "edicao"]);
  });

  it("commenterId nulo (não informado): sem papel a consultar, duas abertas é ambíguo", async () => {
    const tasks = [step("captacao", null), step("edicao", null, { status: "revisao", reviewer_id: "allan" })];
    const admin = fakeAdmin(links, tasks);
    await expectAmbiguous(flowCommentTargetId(admin, delivery()), ["captacao", "edicao"]);
  });

  it("responsável só por nome livre (sem task_assignees) nunca aciona a regra de papel", async () => {
    // "allan" aparece como texto no assignee (fora do escopo deste módulo,
    // que só lê task_assignees) — sem vínculo estruturado, segue ambíguo.
    const tasks = [step("captacao", null), step("edicao", null)];
    const admin = fakeAdmin(links, tasks, []);
    await expectAmbiguous(flowCommentTargetId(admin, delivery(), "allan"), ["captacao", "edicao"]);
  });

  it("papel que aponta DUAS etapas abertas continua ambíguo", async () => {
    const tasks = [step("captacao", null), step("edicao", null)];
    const admin = fakeAdmin(links, tasks, [
      { task_id: "captacao", profile_id: "allan" },
      { task_id: "edicao", profile_id: "allan" },
    ]);
    await expectAmbiguous(flowCommentTargetId(admin, delivery(), "allan"), ["captacao", "edicao"]);
  });
});

// Entrega de Automação: tráfego → feedback → conversão, uma etapa por vez.
describe("resolveFlowCommentTarget — etapa explícita e etapa única", () => {
  const links = [
    { child_id: "trafego", slot: "relatorio_anuncios", position: 10 },
    { child_id: "feedback", slot: "feedback", position: 20 },
    { child_id: "conversao", slot: "relatorio_conversao", position: 30 },
  ];

  it("com stage_task_id de uma etapa ainda aberta, o comentário vai para ela", async () => {
    const admin = fakeAdmin(links.slice(0, 1), [step("trafego", null, { status: "revisao" })]);
    expect(await resolveFlowCommentTarget(admin, delivery(), { stageTaskId: "trafego" })).toEqual({ targetId: "trafego", via: "explicit" });
  });

  // Comentar "na Entrega" é comentar na etapa de AGORA. A tela pode estar um passo
  // atrás (outra aba, o cliente aprovando, a conclusão logo antes de enviar).
  it("etapa informada já concluída e o fluxo avançou (tela desatualizada): vai para a etapa aberta agora", async () => {
    const tasks = [step("trafego", "2026-09-21T12:00:00Z"), step("feedback", null)];
    const admin = fakeAdmin(links.slice(0, 2), tasks);
    expect(await resolveFlowCommentTarget(admin, delivery(), { stageTaskId: "trafego" })).toEqual({ targetId: "feedback", via: "stage_advanced" });
  });

  it("tudo concluído: mantém a etapa informada (não há etapa aberta para onde redirecionar)", async () => {
    const tasks = [step("trafego", "2026-09-21T12:00:00Z"), step("feedback", "2026-09-22T12:00:00Z")];
    const admin = fakeAdmin(links.slice(0, 2), tasks);
    expect(await resolveFlowCommentTarget(admin, delivery(), { stageTaskId: "trafego" })).toEqual({ targetId: "trafego", via: "explicit" });
  });

  it("stage_task_id vence a regra de papel", async () => {
    const tasks = [step("trafego", null), step("feedback", null, { status: "revisao", reviewer_id: "allan" })];
    const admin = fakeAdmin(links.slice(0, 2), tasks);
    expect((await resolveFlowCommentTarget(admin, delivery(), { commenterId: "allan", stageTaskId: "trafego" })).targetId).toBe("trafego");
  });

  it("stage_task_id que não é etapa DESTA entrega → 409 COMMENT_STAGE_INVALID (nunca grava em outro card)", async () => {
    const admin = fakeAdmin(links.slice(0, 1), [step("trafego", null)]);
    const error = await resolveFlowCommentTarget(admin, delivery(), { stageTaskId: "de-outra-entrega" }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
    expect((error as HttpError).details?.code).toBe(COMMENT_STAGE_INVALID);
  });

  it("o id da própria entrega não é um destino válido: comentário nunca cai no pai", async () => {
    const admin = fakeAdmin(links.slice(0, 1), [step("trafego", null)]);
    await expect(resolveFlowCommentTarget(admin, delivery("entrega"), { stageTaskId: "entrega" })).rejects.toBeInstanceOf(HttpError);
  });

  it("sem stage_task_id: exatamente uma etapa aberta (tráfego) é o destino", async () => {
    const admin = fakeAdmin(links.slice(0, 1), [step("trafego", null, { status: "revisao" })]);
    expect(await resolveFlowCommentTarget(admin, delivery())).toEqual({ targetId: "trafego", via: "sole_open" });
  });

  it("sem stage_task_id: tráfego concluído, feedback aberto → feedback", async () => {
    const tasks = [step("trafego", "2026-09-21T12:00:00Z"), step("feedback", null)];
    const admin = fakeAdmin(links.slice(0, 2), tasks);
    expect(await resolveFlowCommentTarget(admin, delivery())).toEqual({ targetId: "feedback", via: "sole_open" });
  });

  it("card que não é entrega + stage_task_id de outro card → 409; o próprio id é aceito", async () => {
    const plano = { id: "plano", kind: "plano_acao", payload: {} } as unknown as TaskRecord;
    await expect(resolveFlowCommentTarget(fakeAdmin([], []), plano, { stageTaskId: "outro" })).rejects.toBeInstanceOf(HttpError);
    expect(await resolveFlowCommentTarget(fakeAdmin([], []), plano, { stageTaskId: "plano" })).toEqual({ targetId: "plano", via: "own" });
  });
});
