import { describe, expect, it } from "vitest";
import { finalizationMoment, isAfter, laterOf, trafficReportFileName, trafficReportIsFinal } from "./reportEntities";

const semRevisor = { reviewer_id: null, completed_at: null };
const comRevisorAberto = { reviewer_id: "rev", completed_at: null };
const comRevisorAprovado = { reviewer_id: "rev", completed_at: "2026-09-18T15:00:00.000Z" };

describe("trafficReportIsFinal", () => {
  it("sem revisor: a geração já é a versão final", () => {
    expect(trafficReportIsFinal({ status: "generated" }, semRevisor)).toBe(true);
  });

  // O cenário que a auditoria achou (A1): PDF v1 criado, humano ainda revisando,
  // e a Automação 2 já rodando sobre ele.
  it("com revisor e etapa em revisão: NÃO é final — a Automação 2 espera", () => {
    expect(trafficReportIsFinal({ status: "generated" }, comRevisorAberto)).toBe(false);
  });

  it("com revisor e etapa aprovada: é final", () => {
    expect(trafficReportIsFinal({ status: "generated" }, comRevisorAprovado)).toBe(true);
  });

  it("revisão substituída nunca é final", () => {
    expect(trafficReportIsFinal({ status: "superseded" }, semRevisor)).toBe(false);
  });

  it("já finalizado continua final mesmo com revisor aberto", () => {
    expect(trafficReportIsFinal({ status: "finalized" }, comRevisorAberto)).toBe(true);
  });
});

describe("finalizationMoment", () => {
  const report = { generated_at: "2026-09-18T08:00:00.000Z", finalized_at: null };

  it("sem revisor: o momento da geração", () => {
    expect(finalizationMoment(report, semRevisor)).toBe("2026-09-18T08:00:00.000Z");
  });

  it("com revisor: o momento da APROVAÇÃO, não o de quando a automação notou", () => {
    expect(finalizationMoment(report, comRevisorAprovado)).toBe("2026-09-18T15:00:00.000Z");
  });

  it("finalized_at gravado vence", () => {
    expect(finalizationMoment({ ...report, finalized_at: "2026-09-18T09:00:00.000Z" }, comRevisorAprovado)).toBe("2026-09-18T09:00:00.000Z");
  });
});

describe("trafficReportFileName", () => {
  it("revisão 1 mantém o nome histórico", () => {
    expect(trafficReportFileName("2026-09-18", 1)).toBe("relatorio-trafego-2026-09-18.pdf");
  });
  it("revisões seguintes ganham sufixo — regerar não colide", () => {
    expect(trafficReportFileName("2026-09-18", 2)).toBe("relatorio-trafego-2026-09-18-r2.pdf");
  });
});

describe("isAfter / laterOf", () => {
  // Carimbo do RPC do Postgres vs toISOString do JS: como string, "2026-09-18 10:00:00+00"
  // ordena ANTES de "2026-09-18T09:00:00.000Z" (espaço < "T"), o que é falso.
  it("compara instantes, não strings, entre os dois formatos de carimbo", () => {
    expect(isAfter("2026-09-18 10:00:00+00", "2026-09-18T09:00:00.000Z")).toBe(true);
    expect(isAfter("2026-09-18T09:00:00.000Z", "2026-09-18 10:00:00+00")).toBe(false);
  });

  it("sem limite, tudo conta", () => {
    expect(isAfter("2026-09-18T09:00:00.000Z", null)).toBe(true);
  });

  it("laterOf escolhe o instante mais recente e tolera ausência", () => {
    expect(laterOf("2026-09-18T09:00:00.000Z", "2026-09-18 10:00:00+00")).toBe("2026-09-18 10:00:00+00");
    expect(laterOf(null, "2026-09-18T09:00:00.000Z")).toBe("2026-09-18T09:00:00.000Z");
    expect(laterOf(undefined, null)).toBeNull();
  });
});
