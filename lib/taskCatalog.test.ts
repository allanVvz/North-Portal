import { describe, expect, it } from "vitest";
import { TASK_KIND_KEYS, canonicalTaskClassification, checkpointsProgress, taskProgress } from "./taskCatalog";
import type { TaskStatus } from "./validation";

const t = (kind: string, status: TaskStatus, progress_weight = 1) => ({ kind, status, progress_weight });

describe("taskProgress — non-plan cards", () => {
  // Um funil só: a porcentagem depende do STATUS, não mais do tipo. Existiam
  // três workflows, e o `criativo_pub` inteiro era por causa de uma etapa —
  // ele guardava os 100% para "Publicado" e dava 90 ao aprovado.
  it("lê a mesma porcentagem para qualquer tipo, no mesmo status", () => {
    expect(taskProgress(t("criativo", "em_producao"))).toBe(35);
    expect(taskProgress(t("operacional", "em_producao"))).toBe(35);
    expect(taskProgress(t("checkpoint_comercial", "em_producao"))).toBe(35);
    expect(taskProgress(t("checkpoint_comercial", "aprovacao"))).toBe(80);
    // Plano fica de fora: ele é rollup dos membros, não do próprio status.
  });

  it("Concluído é 100 para todo tipo — inclusive a Entrega, que valia 90", () => {
    expect(taskProgress(t("criativo", "aprovado"))).toBe(100);
    expect(taskProgress(t("operacional", "aprovado"))).toBe(100);
  });

  it("nenhuma etapa é pulada agora, mas o fallback por índice continua de pé", () => {
    // `parada` não está no mapa: cai no vizinho definido mais próximo abaixo.
    expect(taskProgress(t("operacional", "revisao"))).toBe(60);
  });
});

describe("taskProgress — parada (automation halted the card)", () => {
  it("freezes at the pre-halt status's percentage instead of the array-index fallback", () => {
    const halted = { kind: "criativo", status: "parada" as const, progress_weight: 1, payload: { pre_parada_status: "em_producao" } };
    expect(taskProgress(halted)).toBe(35); // em_producao congelado, não o 100 de aprovado
  });

  it("is 0 when there's no pre_parada_status marker", () => {
    expect(taskProgress(t("criativo", "parada"))).toBe(0);
  });
});

describe("catálogo canônico de tipos", () => {
  it("são exatamente quatro tipos — Rotina é porta de criação, não kind", () => {
    // Rotina não entra aqui de propósito: recorrência é a coluna
    // `recurrence_cadence`, e um kind próprio tornaria "entrega recorrente"
    // irrepresentável. Ver ROTINA_OPTION em app/admin/TaskModal.tsx.
    expect(TASK_KIND_KEYS).toEqual(["operacional", "plano_acao", "criativo", "checkpoint_comercial"]);
    expect(TASK_KIND_KEYS).not.toContain("rotina");
  });

  it("não expõe recorrência, roteiro ou gravação como tipos primários", () => {
    expect(TASK_KIND_KEYS).not.toContain("publicacao_recorrente");
    expect(TASK_KIND_KEYS).not.toContain("roteiro");
    expect(TASK_KIND_KEYS).not.toContain("gravacao");
  });

  it("converte classificações legadas — inclusive os tipos aposentados", () => {
    expect(canonicalTaskClassification("publicacao_recorrente")).toEqual({ kind: "criativo", subtype: null });
    expect(canonicalTaskClassification("roteiro")).toEqual({ kind: "operacional", subtype: "roteiro" });
    expect(canonicalTaskClassification("gravacao")).toEqual({ kind: "operacional", subtype: "gravacao" });
    // Os dois tipos removidos: linha antiga não pode renderizar crua entre o
    // deploy e a migração, nem depois se alguma escapar.
    expect(canonicalTaskClassification("agendamento", "gravacao")).toEqual({ kind: "operacional", subtype: "gravacao" });
    expect(canonicalTaskClassification("planejamento")).toEqual({ kind: "operacional", subtype: null });
  });
});

describe("taskProgress — plan rollup", () => {
  it("is the equal-weighted average of member progress", () => {
    const plan = t("plano_acao", "backlog");
    const members = [t("criativo", "em_producao"), t("criativo", "aprovado")]; // 35, 100
    expect(taskProgress(plan, members)).toBe(68);
  });

  it("respects progress_weight", () => {
    const plan = t("plano_acao", "backlog");
    const members = [t("criativo", "em_producao", 3), t("criativo", "aprovado", 1)]; // (35*3+100)/4
    expect(taskProgress(plan, members)).toBe(51);
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

  it("is the plain average across mixed states", () => {
    // backlog=0, em_producao=35, aprovado=100 -> (0+35+100)/3 = 45
    const cps = [t("checkpoint_comercial", "backlog"), t("checkpoint_comercial", "em_producao"), t("checkpoint_comercial", "aprovado")];
    expect(checkpointsProgress(cps)).toBe(45);
  });

  it("is 100 when every checkpoint is concluded", () => {
    const cps = [t("checkpoint_comercial", "aprovado"), t("checkpoint_comercial", "aprovado")];
    expect(checkpointsProgress(cps)).toBe(100);
  });
});
