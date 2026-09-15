import { describe, expect, it } from "vitest";
import { addDaysIso, contentPlanSteps } from "./contentPlan";

describe("contentPlanSteps", () => {
  it("volume zero não gera etapa", () => {
    expect(contentPlanSteps({ reels: 0, anuncios: 0, carrosseis: 0 })).toEqual([]);
  });

  it("agrupa pelo trabalho: um roteiro e uma gravação para o bloco, edição por formato", () => {
    const titles = contentPlanSteps({ reels: 4, anuncios: 2, carrosseis: 3 }).map((step) => step.title);
    expect(titles).toEqual([
      "Roteiro do bloco — 4 Reels + 2 anúncios + 3 carrosséis",
      "Gravação do bloco — 4 Reels + 2 anúncios",
      "Edição — 4 Reels",
      "Edição — 2 anúncios",
      "Design — 3 carrosséis",
      "Aprovação do cliente — 9 conteúdos",
      "Publicação — 9 conteúdos",
    ]);
  });

  it("só carrosséis não tem gravação nem edição de vídeo", () => {
    const titles = contentPlanSteps({ reels: 0, anuncios: 0, carrosseis: 1 }).map((step) => step.title);
    expect(titles).toEqual(["Roteiro do bloco — 1 carrossel", "Design — 1 carrossel", "Aprovação do cliente — 1 conteúdo", "Publicação — 1 conteúdo"]);
  });

  it("datas contadas do início do plano, em ordem de produção", () => {
    const steps = contentPlanSteps({ reels: 1, anuncios: 0, carrosseis: 0 });
    expect(steps.map((step) => addDaysIso("2026-09-21", step.offsetDays))).toEqual(["2026-09-23", "2026-09-26", "2026-09-30", "2026-10-02", "2026-10-05"]);
  });
});
