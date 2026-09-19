import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";

// O caminho que roda quando o Feedback é concluído: cria o relatório de conversão
// dentro do request de conclusão. É o trecho mais exposto ao banco real — o status
// da Entrega é PROJETADO (o banco recusa escrita direta), e o fake reproduz isso.

vi.setConfig({ testTimeout: 30_000 });

const hooks = vi.hoisted(() => ({
  render: vi.fn(),
  extract: vi.fn(),
}));

vi.mock("@/lib/documentFiles", () => ({
  DOCUMENT_BUCKET: "documentos",
  documentStoragePath: (slug: string, name: string, id?: string) => `${slug}/${id ?? "x"}/${name}`,
}));
vi.mock("@/lib/reports/salesReportPdf", () => ({ renderSalesReportPdf: hooks.render }));
vi.mock("@/lib/ai/extractMetrics", () => ({ extractMetrics: hooks.extract }));
vi.mock("./serviceIntegrations", () => ({ getClientById: vi.fn(async () => ({ id: "cli", slug: "cliente-x", name: "Cliente X" })) }));
vi.mock("./reportData", () => ({
  reportPeriodFor: () => ({ from: "2026-09-14", to: "2026-09-20" }),
  resolveTemplateConfig: vi.fn(async () => ({})),
}));
vi.mock("./creativeAssets", () => ({ loadStoredPreviews: vi.fn(async () => ({})) }));
vi.mock("./clientMetricSeries", () => ({ followerSeries: vi.fn(async () => []), recordFollowerSnapshots: vi.fn(async () => undefined) }));
vi.mock("./responsibleOwners", () => ({ assignResponsibilityHolders: vi.fn(async () => null) }));
vi.mock("./notify", () => ({
  notifyFromAutomation: vi.fn(async () => undefined),
  notifyResponsibilityHolders: vi.fn(async () => undefined),
}));
vi.mock("./reportLog", () => ({ logReportRun: vi.fn() }));

import { processConversionFeedback } from "./conversionFlow";

const OCC = "occ-1";
const TRAFEGO = "trafego-1";
const FEEDBACK = "feedback-1";
const CONVERSAO = "conversao-1";

let db: FakeTaskDb;

const link = (child: string, key: string, position: number) => ({
  parent_id: OCC, child_id: child, relation_kind: "workflow_step", workflow_step_id: `ws-${key}`, slot: key, position,
});

function seed(conversao: Partial<Row> = {}) {
  db = createFakeTaskDb({
    tasks: [
      // Molde da Entrega de Automação. `report_example` mantém a série de métricas
      // do cliente fora do teste — o que se prova aqui é o fluxo de status/comentário.
      { id: "entrega-mold", client_id: "cli", kind: "automacao", title: "Entrega", status: "backlog", due_date: "2026-09-21", recurrence_cadence: "semanal", workflow_version_id: "wv", payload: { recurrence_group: true, report_example: true } },
      { id: OCC, client_id: "cli", kind: "automacao", title: "Entrega", status: "backlog", due_date: "2026-09-23", workflow_version_id: "wv", payload: { recurrence_parent_id: "entrega-mold", occurrence_date: "2026-09-21", recurrence_cycle: 1 } },
      { id: TRAFEGO, client_id: "cli", kind: "operacional", subtype: "relatorio_anuncios", status: "aprovado", reviewer_id: null, payload: { comments: [] } },
      { id: FEEDBACK, client_id: "cli", kind: "operacional", subtype: "feedback", status: "aprovado", payload: { comments: [{ author: "Allan", text: "Vendas: 5\nAgendamentos: 8", at: "2026-09-22T15:00:00.000Z" }] } },
      { id: CONVERSAO, client_id: "cli", kind: "operacional", subtype: "relatorio_conversao", status: "backlog", payload: { comments: [] }, ...conversao },
    ],
    task_links: [link(TRAFEGO, "relatorio_anuncios", 10), link(FEEDBACK, "feedback", 20), link(CONVERSAO, "relatorio_conversao", 30)],
    workflow_versions: [{ id: "wv", delivery_type_id: "t-auto", version: 1, label: "Automação v1", status: "published" }],
    workflow_version_steps: [
      { id: "ws-relatorio_anuncios", workflow_version_id: "wv", task_type_id: "s1", step_key: "relatorio_anuncios", label: "Relatório de anúncios", order_index: 10, progress_weight: 1, lead_days: 0, creation_trigger: "delivery_created", default_assignee: null, client_visible: false },
      { id: "ws-feedback", workflow_version_id: "wv", task_type_id: "s2", step_key: "feedback", label: "Feedback", order_index: 20, progress_weight: 1, lead_days: 2, creation_trigger: "previous_step_approved", default_assignee: null, client_visible: false },
      { id: "ws-relatorio_conversao", workflow_version_id: "wv", task_type_id: "s3", step_key: "relatorio_conversao", label: "Relatório de conversão", order_index: 30, progress_weight: 1, lead_days: 0, creation_trigger: "previous_step_approved", default_assignee: null, client_visible: false },
    ],
    traffic_reports: [{ id: "tr-1", client_id: "cli", task_id: TRAFEGO, occurrence_id: OCC, period_from: "2026-09-14", period_to: "2026-09-20", revision: 1, snapshot: {}, status: "finalized", document_id: null, generated_at: "2026-09-21T11:00:00.000Z", finalized_at: "2026-09-21T13:00:00.000Z" }],
    automation_configs: [
      { id: "cfg-ads", automation_key: "relatorio_trafego_semanal", target_task_id: "ads-mold", active: true, depends_on_config_id: null },
      { id: "cfg-conversao", automation_key: "relatorio_conversao", target_task_id: "entrega-mold", active: true, depends_on_config_id: "cfg-ads", collect_metric_keys: null, performance_template_id: null },
    ],
  });
}

const conversaoTexts = () => db.comments(CONVERSAO).map((comment) => String(comment.text));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.render.mockResolvedValue(Buffer.from("%PDF"));
  hooks.extract.mockResolvedValue({ valores: { vendas: 5, agendamentos: 8, receita: null, seguidores: null }, linhas: [], note: "parser" });
  seed();
});

describe("conversão depois do Feedback concluído", () => {
  it("gera o relatório e deixa a etapa de conversão em Revisão — sem escrever o status da Entrega", async () => {
    await processConversionFeedback(db.asAdmin(), OCC);

    expect(hooks.render).toHaveBeenCalledTimes(1);
    expect(db.task(CONVERSAO)!.status).toBe("revisao");
    // A Entrega acompanha a etapa aberta (projeção do banco), sem escrita direta.
    expect(db.task(OCC)!.status).toBe("revisao");
    expect(db.table("documents")).toHaveLength(1);
    expect(db.table("conversion_reports")).toHaveLength(1);
    expect(db.table("conversion_report_snapshots")).toHaveLength(1);
    expect(conversaoTexts()).toEqual([
      expect.stringContaining("North IA consolidou o período"),
      expect.stringContaining("Relatório de conversão atualizado"),
    ]);
    const occPayload = db.task(OCC)!.payload as Row;
    expect(occPayload.conversion_report_generated_at).toBeTruthy();
    expect(occPayload).toHaveProperty("feedback_source_at");
    // O comentário humano do Feedback continua onde foi escrito.
    expect(db.comments(FEEDBACK).map((c) => c.text)).toEqual(["Vendas: 5\nAgendamentos: 8"]);
  });

  it("nenhuma escrita de status foi tentada na Entrega (o banco recusaria)", async () => {
    await processConversionFeedback(db.asAdmin(), OCC);
    const tentativas = db.updates.filter((update) => update.table === "tasks" && update.id === OCC && "status" in update.patch);
    expect(tentativas).toEqual([]);
    // Nem uma tarefa foi parada por erro: o processamento terminou sem exceção.
    expect(db.table("tasks").filter((row) => row.status === "parada")).toEqual([]);
  });

  it("chamada repetida (retry / clique duplo) não gera segundo relatório nem segundo comentário", async () => {
    await processConversionFeedback(db.asAdmin(), OCC);
    await processConversionFeedback(db.asAdmin(), OCC);
    await Promise.all([processConversionFeedback(db.asAdmin(), OCC), processConversionFeedback(db.asAdmin(), OCC)]);

    expect(hooks.render).toHaveBeenCalledTimes(1);
    expect(db.table("documents")).toHaveLength(1);
    expect(db.table("conversion_reports")).toHaveLength(1);
    expect(conversaoTexts().filter((text) => text.includes("Relatório de conversão atualizado"))).toHaveLength(1);
  });

  it("conversão que uma pessoa já aprovou não é regerada nem reaberta", async () => {
    seed({ status: "aprovado" });

    await processConversionFeedback(db.asAdmin(), OCC);

    expect(hooks.render).not.toHaveBeenCalled();
    expect(db.task(CONVERSAO)!.status).toBe("aprovado");
    expect(db.task(CONVERSAO)!.completed_at).toBeTruthy();
    expect(db.table("conversion_reports")).toHaveLength(0);
  });

  it("comentário humano feito na conversão durante a geração permanece", async () => {
    hooks.render.mockImplementation(async () => {
      await db.rpc("append_task_comment_idempotent", { p_task_id: CONVERSAO, p_author_id: "u1", p_text: "Confira o valor da receita", p_comment_id: "human-0009" });
      return Buffer.from("%PDF");
    });

    await processConversionFeedback(db.asAdmin(), OCC);

    expect(conversaoTexts()).toContain("Confira o valor da receita");
    expect(conversaoTexts().some((text) => text.includes("Relatório de conversão atualizado"))).toBe(true);
  });

  it("comentário de revisão cria uma versão nova com o contexto consolidado", async () => {
    await processConversionFeedback(db.asAdmin(), OCC);
    await db.rpc("append_task_comment_idempotent", {
      p_task_id: CONVERSAO,
      p_author_id: "u1",
      p_text: "Corrigindo: Vendas: 4",
      p_comment_id: "human-revision-4",
    });
    hooks.extract.mockImplementation(async (text: string) => text.includes("Vendas: 4")
      ? { valores: { vendas: 4, agendamentos: null, receita: null, seguidores: null }, linhas: [], note: "parser" }
      : { valores: { vendas: 5, agendamentos: 8, receita: null, seguidores: null }, linhas: [], note: "parser" });

    await processConversionFeedback(db.asAdmin(), OCC);

    expect(hooks.render).toHaveBeenCalledTimes(2);
    expect(db.table("documents")).toHaveLength(2);
    expect(db.table("conversion_reports")).toHaveLength(2);
    expect(db.table("conversion_report_snapshots")).toHaveLength(2);
    expect(db.task(CONVERSAO)!.status).toBe("revisao");
    expect(conversaoTexts().some((text) => text.includes("North IA consolidou"))).toBe(true);
  });

  it("falha ao gerar o PDF: a reivindicação é liberada (o retry funciona) e o erro fica visível", async () => {
    hooks.render.mockRejectedValueOnce(new Error("react-pdf falhou"));

    await processConversionFeedback(db.asAdmin(), OCC);
    expect(db.table("conversion_reports")).toHaveLength(0);
    // O erro aparece como comentário na Entrega, que não tem status próprio.
    expect(db.comments(OCC).map((c) => String(c.text)).some((text) => text.includes("react-pdf falhou"))).toBe(true);

    await processConversionFeedback(db.asAdmin(), OCC);
    expect(db.table("conversion_reports")).toHaveLength(1);
    expect(db.task(CONVERSAO)!.status).toBe("revisao");
  });
});
