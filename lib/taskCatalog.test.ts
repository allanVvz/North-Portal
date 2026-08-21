import { describe, expect, it } from "vitest";
import { TASK_KIND_KEYS, canonicalTaskClassification, checkpointsProgress, taskProgress } from "./taskCatalog";
import type { TaskStatus } from "./validation";

const t = (kind: string, status: TaskStatus, progress_weight = 1) => ({ kind, status, progress_weight });

describe("taskProgress — non-plan cards", () => {
  it("reads the workflow percentage for the card's status", () => {
    expect(taskProgress(t("criativo", "em_producao"))).toBe(30); // criativo_pub
    expect(taskProgress(t("criativo", "concluido"))).toBe(100);
    expect(taskProgress(t("agendamento", "aprovacao"))).toBe(80); // padrao
  });

  it("uses the 'simples' workflow for operacional (no review/approval steps)", () => {
    expect(taskProgress(t("operacional", "em_producao"))).toBe(60);
    expect(taskProgress(t("operacional", "concluido"))).toBe(100);
  });

  it("falls back to the nearest earlier defined status when a stage is skipped", () => {
    // 'revisao' isn't in the 'simples' workflow → nearest at/below is em_producao (60).
    expect(taskProgress(t("operacional", "revisao"))).toBe(60);
  });
});

describe("taskProgress — parada (automation halted the card)", () => {
  it("freezes at the pre-halt status's percentage instead of the array-index fallback", () => {
    const halted = { kind: "criativo", status: "parada" as const, progress_weight: 1, payload: { pre_parada_status: "em_producao" } };
    expect(taskProgress(halted)).toBe(30); // criativo_pub's em_producao, not concluido's 100
  });

  it("is 0 when there's no pre_parada_status marker", () => {
    expect(taskProgress(t("criativo", "parada"))).toBe(0);
  });
});

describe("catálogo canônico de tipos", () => {
  it("não expõe recorrência, roteiro ou gravação como tipos primários", () => {
    expect(TASK_KIND_KEYS).not.toContain("publicacao_recorrente");
    expect(TASK_KIND_KEYS).not.toContain("roteiro");
    expect(TASK_KIND_KEYS).not.toContain("gravacao");
  });

  it("converte classificações legadas para tipo e subtipo sem perder leitura", () => {
    expect(canonicalTaskClassification("publicacao_recorrente")).toEqual({ kind: "criativo", subtype: null });
    expect(canonicalTaskClassification("roteiro")).toEqual({ kind: "planejamento", subtype: "roteiro" });
    expect(canonicalTaskClassification("gravacao")).toEqual({ kind: "agendamento", subtype: "gravacao" });
  });
});

describe("taskProgress — plan rollup", () => {
  it("is the equal-weighted average of member progress", () => {
    const plan = t("plano_acao", "backlog");
    const members = [t("criativo", "em_producao"), t("criativo", "concluido")]; // 30, 100
    expect(taskProgress(plan, members)).toBe(65);
  });

  it("respects progress_weight", () => {
    const plan = t("plano_acao", "backlog");
    const members = [t("criativo", "em_producao", 3), t("criativo", "concluido", 1)]; // (30*3+100)/4
    expect(taskProgress(plan, members)).toBe(48);
  });

  it("is 0 for a plan with no members", () => {
    expect(taskProgress(t("plano_acao", "backlog"), [])).toBe(0);
  });
});

describe("checkpointsProgress — onboarding % from checkpoint_comercial cards", () => {
  it("is 0 for an empty list (no checkpoints provisioned yet)", () => {
    expect(checkpointsProgress([])).toBe(0);
  });

  it("is 0 when every checkpoint is still at backlog", () => {
    const cps = [t("checkpoint_comercial", "backlog"), t("checkpoint_comercial", "backlog")];
    expect(checkpointsProgress(cps)).toBe(0);
  });

  it("is the plain average across mixed states (workflow 'padrao')", () => {
    // backlog=0, em_producao=35, concluido=100 -> (0+35+100)/3 = 45
    const cps = [t("checkpoint_comercial", "backlog"), t("checkpoint_comercial", "em_producao"), t("checkpoint_comercial", "concluido")];
    expect(checkpointsProgress(cps)).toBe(45);
  });

  it("is 100 when every checkpoint is concluido", () => {
    const cps = [t("checkpoint_comercial", "concluido"), t("checkpoint_comercial", "aprovado")];
    expect(checkpointsProgress(cps)).toBe(100);
  });
});
