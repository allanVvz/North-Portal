import { beforeEach, describe, expect, it, vi } from "vitest";

// A frase sai do workflow VERSIONADO da ocorrência, nunca de uma lista fixa: quem
// reordena as etapas na tela de Etapas muda o aviso sem tocar em código.

const hooks = vi.hoisted(() => ({ byVersion: vi.fn() }));
vi.mock("@/lib/workflows", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workflows")>("@/lib/workflows");
  return { ...actual, workflowByVersionId: hooks.byVersion };
});

import { nextStepNotice, withNextStepNotice } from "./nextStepNotice";
import type { AdminClient } from "./taskAccess";

const admin = {} as AdminClient;
const step = (key: string, label: string, i: number) => ({
  key, label, order_index: i, workflow_step_id: `ws-${key}`, task_type_id: `tt-${key}`,
  lead_days: 0, progress_weight: 1, default_assignee: null, client_visible: true,
  creation_trigger: "previous_step_approved" as const,
});
const WORKFLOW = {
  id: "wv-1", delivery_type_id: "dt", version: 1, label: "Automação",
  steps: [step("relatorio_anuncios", "Relatório de anúncios", 0), step("feedback", "Feedback", 1), step("relatorio_conversao", "Relatório de conversão", 2)],
};

describe("nextStepNotice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nomeia a próxima etapa", async () => {
    hooks.byVersion.mockResolvedValue(WORKFLOW);
    expect(await nextStepNotice(admin, { workflow_version_id: "wv-1" }, "relatorio_anuncios"))
      .toBe('Ao aprovar esta etapa, a próxima é "Feedback".');
  });

  it("na última etapa, diz que aprovar conclui a Entrega", async () => {
    hooks.byVersion.mockResolvedValue(WORKFLOW);
    expect(await nextStepNotice(admin, { workflow_version_id: "wv-1" }, "relatorio_conversao"))
      .toBe("Esta é a última etapa: aprovar conclui a Entrega.");
  });

  it("sem workflow na ocorrência, não chuta nada", async () => {
    expect(await nextStepNotice(admin, { workflow_version_id: null }, "relatorio_anuncios")).toBeNull();
    expect(hooks.byVersion).not.toHaveBeenCalled();
  });

  it("etapa desconhecida no workflow devolve null em vez de errar a frase", async () => {
    hooks.byVersion.mockResolvedValue(WORKFLOW);
    expect(await nextStepNotice(admin, { workflow_version_id: "wv-1" }, "inexistente")).toBeNull();
  });

  it("falha ao ler o workflow não derruba a geração do relatório", async () => {
    hooks.byVersion.mockRejectedValue(new Error("banco fora"));
    expect(await nextStepNotice(admin, { workflow_version_id: "wv-1" }, "feedback")).toBeNull();
  });

  it("withNextStepNotice não deixa linha em branco sobrando", () => {
    expect(withNextStepNotice("corpo", null)).toBe("corpo");
    expect(withNextStepNotice("corpo", "aviso")).toBe("corpo\n\naviso");
  });
});
