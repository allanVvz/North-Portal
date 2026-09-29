import { describe, expect, it } from "vitest";
import { buildInsightCandidates } from "./insightCandidates";
import { normalizeOperationItems, type OperationTask } from "../operacao/operationItems";
import type { ClientInsight } from "@/lib/insights/clientInsights";

const today = "2026-09-30";
const task = (id: string, extra: Partial<OperationTask>): OperationTask => ({
  id, title: id, kind: "operacional", subtype: null, status: "em_producao", client_id: "c", description: null, payload: {}, parents: [],
  completed_at: null, due_date: null, workflow_version_id: null, recurrence_cadence: null, assignee: null, priority: null,
  clientName: "Baita", clientSlug: "baita", ...extra,
} as unknown as OperationTask);

const week = (periodTo: string, reach: number) => ({ periodFrom: periodTo, periodTo, spend: 100, reach, impressions: null, linkClicks: null, profileVisits: null, conversations: null, outcome: "conversas" as ClientInsight["media"][number]["outcome"], outcomeLabel: "Conversas", outcomeValue: 5, outcomeCost: 20, reachCorrected: false, documentId: null }) as ClientInsight["media"][number];
const insight = (slug: string, name: string, extra: Partial<ClientInsight>): ClientInsight => ({ clientId: slug, slug, name, media: [], followers: [], conversion: [], reports: [], nextReport: null, ...extra } as ClientInsight);

describe("insights das telas", () => {
  const tasks = [
    ...["a", "b", "c", "d"].map((id) => task(id, { assignee: "Cintia Souza", due_date: "2026-09-20" })),
    task("e", { assignee: "Luiza", due_date: "2026-09-25" }),
    task("f", { assignee: null, due_date: "2026-10-01" }),
  ];
  const items = normalizeOperationItems(tasks, []);

  it("quem concentra os atrasos, com o número que o link mostra", () => {
    const owner = buildInsightCandidates("home", { items, tasks, today }).find((candidate) => candidate.id === "late-owner");
    expect(owner?.title).toBe("Cintia concentra 4 dos 5 atrasos");
    expect(owner?.href).toContain("responsavel=Cintia");
    expect(owner?.href).toContain("situacao=atrasada");
  });

  it("cada tela só recebe os seus tipos, em ordem de peso", () => {
    const insights = [
      insight("karpinski", "Karpinski", { nextReport: "2026-09-22" }),
      insight("falke", "Falke", { media: [week("2026-09-20", 20000), week("2026-09-27", 12000)] }),
    ];
    const clientes = buildInsightCandidates("clientes", { items, tasks, today, insights });
    expect(clientes.map((candidate) => candidate.id)).toEqual(expect.arrayContaining(["late-client", "report-late", "reach-drop"]));
    expect(clientes.some((candidate) => candidate.id === "late-owner")).toBe(false);
    expect([...clientes].sort((a, b) => b.weight - a.weight)).toEqual(clientes);
    expect(clientes.find((candidate) => candidate.id === "reach-drop")?.title).toBe("Alcance de Falke caiu 40% na semana");
    expect(clientes.find((candidate) => candidate.id === "report-late")?.href).toBe("/admin/karpinski/visao");
  });

  it("na tela de um cliente, tudo fica recortado nele", () => {
    const other = task("x", { assignee: "Cintia", due_date: "2026-09-01", clientName: "Cris", clientSlug: "cris" });
    const all = normalizeOperationItems([...tasks, other], []);
    const cliente = buildInsightCandidates("cliente", { items: all, tasks: [...tasks, other], today, client: { slug: "cris", name: "Cris" } });
    expect(cliente.find((candidate) => candidate.id === "late-owner")).toBeUndefined();
    expect(cliente.every((candidate) => !candidate.title.includes("Baita"))).toBe(true);
  });
});
