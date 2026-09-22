import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";
import type { WindsorSettings } from "@/lib/windsor";
import type { ServiceMetaSettings } from "./serviceIntegrations";
import type { TaskRecord } from "@/lib/validation";

// A geração do relatório de tráfego leva segundos (Windsor, previews, PDF). O
// render mockado abaixo é o ponto em que o mundo "muda no meio": uma pessoa
// comenta, conclui a etapa, ou a geração falha. O que se prova é o que sobra no
// banco depois que a automação termina.

// run.ts puxa um grafo grande; sob a suíte inteira o import estoura os 5s padrão.
vi.setConfig({ testTimeout: 30_000 });

const hooks = vi.hoisted(() => ({
  render: vi.fn(),
  ensureFlowOccurrence: vi.fn(),
  materializeFirstStep: vi.fn(),
  advanceFlowMold: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./notify", () => ({
  notifyFromAutomation: vi.fn(async () => undefined),
  notifyResponsibilityHolders: vi.fn(async () => undefined),
}));
vi.mock("@/lib/documentFiles", () => ({
  DOCUMENT_BUCKET: "documentos",
  documentStoragePath: (slug: string, name: string) => `${slug}/${name}`,
}));
vi.mock("@/app/admin/performance/insights", () => ({
  inPeriod: () => true,
  previousPeriod: () => ({ from: "2026-09-07", to: "2026-09-13" }),
}));
vi.mock("@/lib/reports/adsReportPdf", () => ({
  renderAdsReportPdf: hooks.render,
  trafficFinalViewOf: (instruction?: string | null) => ({
    reach: null, hideClicks: false, hideImpressions: false, hideTrend: false, instruction: instruction ?? null,
  }),
}));
vi.mock("@/lib/reports/adsInsights", () => ({
  creativeRows: () => ({ rows: [] }),
  mediaOutcome: () => "outcome",
  mediaTotals: () => ({}),
}));
vi.mock("./creativeAssets", () => ({ collectAndStorePreviews: vi.fn(async () => ({ stored: {}, assets: {} })) }));
vi.mock("./reportData", () => ({
  reportPeriodFor: () => ({ from: "2026-09-14", to: "2026-09-20" }),
  resolveTemplateConfig: vi.fn(async () => ({})),
  fetchPostsForAccount: vi.fn(async () => ({ campaignPosts: [], adPosts: [] })),
}));
vi.mock("./serviceIntegrations", () => ({
  getClientById: vi.fn(async () => ({ id: "cli", slug: "cliente-x", name: "Cliente X" })),
  adsAccountFor: vi.fn(() => ({ provider: "windsor", account: "act_1" })),
  getMetaSettingsService: vi.fn(async () => ({ accessToken: null })),
  getWindsorSettingsService: vi.fn(async () => ({})),
}));
vi.mock("./reportLog", () => ({ logReportRun: vi.fn() }));
vi.mock("./execute", () => ({
  ensureFlowOccurrence: hooks.ensureFlowOccurrence,
  advanceFlowMold: hooks.advanceFlowMold,
  materializeOccurrenceForReport: vi.fn(),
  clonePlanForReport: vi.fn(),
}));
vi.mock("./conversionFlow", () => ({ runConversionFlow: vi.fn() }));
vi.mock("@/lib/flows/advance", () => ({ materializeFirstStep: hooks.materializeFirstStep }));

import { handleTrafficRevisionComment, runOneReportAutomation, type AutomationConfigRow } from "./run";

const TODAY = "2026-09-21";
const ADS_CONFIG: AutomationConfigRow = {
  id: "cfg-ads", automation_key: "relatorio_trafego_semanal", target_task_id: "ads-mold",
  performance_template_id: null, active: true, collect_metric_keys: null, depends_on_config_id: null,
};

let db: FakeTaskDb;
let duringGeneration: (() => Promise<void>) | null;

const asRecord = (row: Row | undefined) => row as unknown as TaskRecord;
const human = (taskId: string, text: string, commentId: string) =>
  db.rpc("append_task_comment_idempotent", { p_task_id: taskId, p_author_id: "u1", p_text: text, p_comment_id: commentId });
const approve = (taskId: string) => db.from("tasks").update({ status: "aprovado" }).eq("id", taskId).then(() => undefined);

function seed(cardOverrides: Partial<Row> = {}, occOverrides: Partial<Row> = {}) {
  db = createFakeTaskDb({
    tasks: [
      { id: "ads-mold", client_id: "cli", kind: "operacional", subtype: "relatorio_anuncios", status: "backlog", due_date: TODAY, recurrence_cadence: "semanal", reviewer_id: null, payload: { recurrence_group: true, recurrence_cycle: 0 } },
      { id: "entrega-mold", client_id: "cli", kind: "automacao", status: "backlog", due_date: TODAY, recurrence_cadence: "semanal", workflow_version_id: "wv", payload: { recurrence_group: true, recurrence_cycle: 0 } },
      { id: "occ-1", client_id: "cli", kind: "automacao", status: "backlog", due_date: TODAY, workflow_version_id: "wv", workflow_activated_at: null, payload: { recurrence_parent_id: "entrega-mold", occurrence_date: TODAY, recurrence_cycle: 1 }, ...occOverrides },
      { id: "trafego-1", client_id: "cli", kind: "operacional", subtype: "relatorio_anuncios", status: "backlog", reviewer_id: null, payload: { comments: [] }, ...cardOverrides },
    ],
    task_links: [{ parent_id: "occ-1", child_id: "trafego-1", relation_kind: "workflow_step", workflow_step_id: "ws-ads", slot: "relatorio_anuncios", position: 10 }],
    automation_configs: [
      { ...ADS_CONFIG },
      { id: "cfg-conversao", automation_key: "relatorio_conversao", target_task_id: "entrega-mold", depends_on_config_id: "cfg-ads", active: true },
    ],
  });
  hooks.ensureFlowOccurrence.mockImplementation(async () => asRecord(db.task("occ-1")));
  hooks.materializeFirstStep.mockImplementation(async () => asRecord(db.task("trafego-1")));
}

const run = () => runOneReportAutomation(db.asAdmin(), ADS_CONFIG, {} as WindsorSettings, { accessToken: null } as unknown as ServiceMetaSettings, TODAY);
const trafficTexts = () => db.comments("trafego-1").map((comment) => String(comment.text));

beforeEach(() => {
  vi.clearAllMocks();
  duringGeneration = null;
  hooks.render.mockImplementation(async () => {
    await duringGeneration?.();
    return Buffer.from("%PDF");
  });
  hooks.advanceFlowMold.mockImplementation(async (_admin: unknown, mold: TaskRecord) => mold);
  seed();
});

describe("relatório de anúncios — comentário durante a geração", () => {
  it("o relatório é salvo E o comentário humano feito durante a geração permanece", async () => {
    duringGeneration = async () => { await human("trafego-1", "Cuidado com a verba deste mês", "human-0001"); };

    const outcome = await run();

    expect(outcome).toBe("ran");
    expect(db.table("traffic_reports")).toHaveLength(1);
    expect(db.table("documents")).toHaveLength(1);
    expect(trafficTexts()).toEqual([
      "Cuidado com a verba deste mês",
      expect.stringContaining("Relatório de anúncios gerado e anexado"),
    ]);
    expect(db.task("trafego-1")!.status).toBe("revisao");
    expect(hooks.advanceFlowMold).toHaveBeenCalledTimes(1);
  });

  it("chaves gravadas por outro caminho durante a geração também sobrevivem", async () => {
    duringGeneration = async () => {
      const task = db.task("trafego-1")!;
      task.payload = { ...(task.payload as Row), formato: "reels" };
    };
    await run();
    expect((db.task("trafego-1")!.payload as Row).formato).toBe("reels");
  });
});

describe("relatório de anúncios — execução antiga não desfaz ação humana", () => {
  it("uma pessoa concluiu a etapa durante a geração: o status não é rebaixado, o relatório e o comentário ficam", async () => {
    duringGeneration = async () => {
      await human("trafego-1", "Primeiro relatório está correto", "human-0002");
      await approve("trafego-1");
    };

    const outcome = await run();

    expect(outcome).toBe("ran");
    expect(db.task("trafego-1")!.status).toBe("aprovado");
    expect(db.task("trafego-1")!.completed_at).toBeTruthy();
    expect(trafficTexts()[0]).toBe("Primeiro relatório está correto");
    expect(trafficTexts()).toHaveLength(2);
    expect(db.table("traffic_reports")).toHaveLength(1);
    // O relatório saiu: o molde precisa avançar mesmo assim, senão o cron de
    // amanhã não acharia o vencimento e o ciclo travaria.
    expect(hooks.advanceFlowMold).toHaveBeenCalledTimes(1);
  });

  it("etapa que já passou para revisão (relatório já gerado) não é regerada nem rebaixada", async () => {
    seed({ status: "revisao" });

    const outcome = await run();

    expect(outcome).toBe("not_due");
    expect(hooks.render).not.toHaveBeenCalled();
    expect(db.task("trafego-1")!.status).toBe("revisao");
    expect(db.table("traffic_reports")).toHaveLength(0);
  });

  it("o pulo por etapa em revisão é EXPLICADO no molde — sair calado travou 2 clientes em 21/09", async () => {
    // O ciclo anterior não fechou, então a transição não pega e o molde não
    // avança. Como o gate é `due_date = hoje` estrito, isso congela a automação
    // para sempre: antes, sem erro e sem comentário, ninguém descobria.
    seed({ status: "revisao" });

    expect(await run()).toBe("not_due");

    const [comentario] = db.comments("ads-mold");
    expect(String(comentario.text)).toContain("não gerou o relatório de 21/09");
    expect(String(comentario.text)).toContain("ainda está em revisao");
    expect(comentario.id).toBe("automation-missed:cfg-ads:2026-09-21");
  });

  it("o mesmo ciclo travado não acumula comentário a cada dia", async () => {
    seed({ status: "revisao" });

    await run();
    await run();

    expect(db.comments("ads-mold")).toHaveLength(1);
  });

  it("etapa já aprovada por uma pessoa não é reaberta por um retry", async () => {
    seed({ status: "aprovado" });
    expect(await run()).toBe("not_due");
    expect(hooks.render).not.toHaveBeenCalled();
    expect(db.task("trafego-1")!.status).toBe("aprovado");
  });

  it("retry depois de um crash no meio (etapa ficou em produção) gera normalmente", async () => {
    seed({ status: "em_producao" });
    expect(await run()).toBe("ran");
    expect(db.task("trafego-1")!.status).toBe("revisao");
  });

  it("falha na geração depois de uma pessoa concluir a etapa: a etapa NÃO vira `parada`", async () => {
    hooks.render.mockImplementation(async () => {
      await approve("trafego-1");
      throw new Error("Windsor fora do ar");
    });

    const outcome = await run();

    expect(outcome).toEqual({ error: "Windsor fora do ar" });
    expect(db.task("trafego-1")!.status).toBe("aprovado");
  });

  it("falha na geração sem interferência: a etapa fica `parada` com um comentário explicando", async () => {
    hooks.render.mockRejectedValue(new Error("Windsor fora do ar"));

    expect(await run()).toEqual({ error: "Windsor fora do ar" });
    expect(db.task("trafego-1")!.status).toBe("parada");
    expect(trafficTexts()).toEqual([expect.stringContaining("Falha ao gerar o relatório de anúncios")]);
  });

  it("a ocorrência ganha `workflow_activated_at` uma vez e retry não reescreve o carimbo", async () => {
    await run();
    expect(db.task("occ-1")!.workflow_activated_at).toBeTruthy();

    seed({ status: "em_producao" }, { workflow_activated_at: "2026-09-21T11:00:00.000Z" });
    await run();
    expect(db.task("occ-1")!.workflow_activated_at).toBe("2026-09-21T11:00:00.000Z");
  });
});

describe("handleTrafficRevisionComment — comentário no tráfego pede nova revisão", () => {
  function seedRevision(cardOverrides: Partial<Row> = {}) {
    seed(
      {
        status: "revisao",
        payload: { comments: [{ author: "Allan", text: "está aprovado", at: "2026-09-21T12:00:00.000Z" }] },
        ...cardOverrides,
      },
      // Topologia REAL: a ocorrência aponta para o molde da ENTREGA; a config de
      // anúncios mora em outro molde e só se liga a este pela config de vendas
      // (`depends_on_config_id`). Semear a config no molde da ocorrência escondia isso.
      { payload: { recurrence_parent_id: "entrega-mold", occurrence_date: TODAY, recurrence_cycle: 1, feedback_source_at: "x", sales_report_generated_at: "y", keepme: "sim" } },
    );
    db.table("tasks").push(
      { id: "feedback-1", status: "em_producao", payload: {} },
      { id: "conversao-1", status: "backlog", payload: {} },
    );
  }

  it("etapa de tráfego já concluída: não regenera (a Conversão já se apoia neste relatório)", async () => {
    seedRevision({ status: "aprovado" });

    await handleTrafficRevisionComment(db.asAdmin(), "trafego-1");

    expect(hooks.render).not.toHaveBeenCalled();
    expect(db.table("traffic_reports")).toHaveLength(0);
    expect(db.task("trafego-1")!.status).toBe("aprovado");
  });

  it("regenera: comentário atômico, instrução gravada, marcadores da ocorrência removidos sem tocar no resto", async () => {
    seedRevision();

    await handleTrafficRevisionComment(db.asAdmin(), "trafego-1");

    expect(hooks.render).toHaveBeenCalledTimes(1);
    expect(trafficTexts()).toEqual(["está aprovado", expect.stringContaining("North Ai aplicou a instrução de revisão")]);
    expect((db.task("trafego-1")!.payload as Row).traffic_revision_instruction).toBe("está aprovado");
    expect(db.task("trafego-1")!.status).toBe("revisao");
    const occPayload = db.task("occ-1")!.payload as Row;
    expect(occPayload).not.toHaveProperty("feedback_source_at");
    expect(occPayload).not.toHaveProperty("sales_report_generated_at");
    expect(occPayload.keepme).toBe("sim");
  });

  it("comentário humano feito durante a regeneração permanece", async () => {
    seedRevision();
    duringGeneration = async () => { await human("trafego-1", "Troque a imagem da capa", "human-0003"); };

    await handleTrafficRevisionComment(db.asAdmin(), "trafego-1");

    expect(trafficTexts()).toEqual([
      "está aprovado",
      "Troque a imagem da capa",
      expect.stringContaining("North Ai aplicou a instrução de revisão"),
    ]);
  });

  it("execução antiga: a pessoa concluiu a etapa durante a regeneração → conclusão preservada, nada resetado", async () => {
    seedRevision();
    duringGeneration = async () => { await approve("trafego-1"); };

    await handleTrafficRevisionComment(db.asAdmin(), "trafego-1");

    expect(db.task("trafego-1")!.status).toBe("aprovado");
    expect(db.task("trafego-1")!.completed_at).toBeTruthy();
    // O relatório novo ficou salvo e comentado, mas a ocorrência e as etapas
    // seguintes não foram mexidas.
    expect(trafficTexts()).toContainEqual(expect.stringContaining("North Ai aplicou a instrução de revisão"));
    expect(db.task("occ-1")!.payload).toHaveProperty("feedback_source_at");
    expect(db.task("feedback-1")!.status).toBe("em_producao");
    expect(db.task("conversao-1")!.status).toBe("backlog");
  });

  it("etapas seguintes JÁ concluídas não são reabertas ao resetar", async () => {
    seedRevision();
    await approve("feedback-1");

    await handleTrafficRevisionComment(db.asAdmin(), "trafego-1");

    expect(db.task("feedback-1")!.status).toBe("aprovado");
    expect(db.task("feedback-1")!.completed_at).toBeTruthy();
    expect(db.task("conversao-1")!.status).toBe("backlog");
  });
});
