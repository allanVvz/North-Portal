import { describe, expect, it } from "vitest";
import { formatPeriod, formatShortDate, isOverdue, relativeDue } from "./taskDates";
import { todayInTimezone } from "./recurringState";

describe("formatShortDate", () => {
  it("formata dia + mês abreviado", () => {
    expect(formatShortDate("2026-08-12")).toMatch(/^12 de ago\.?$|^12 ago\.?$/);
  });

  it("não desloca o dia por fuso (2026-08-12 nunca vira 11)", () => {
    expect(formatShortDate("2026-08-12")).toContain("12");
  });

  it("diz 'Sem data' quando não há prazo", () => {
    expect(formatShortDate(null)).toBe("Sem data");
  });
});

describe("relativeDue", () => {
  const today = "2026-08-19";

  it("traduz as datas próximas", () => {
    expect(relativeDue("2026-08-19", today)).toBe("hoje");
    expect(relativeDue("2026-08-20", today)).toBe("amanhã");
    expect(relativeDue("2026-08-18", today)).toBe("ontem");
  });

  it("conta dias para trás e para frente", () => {
    expect(relativeDue("2026-08-16", today)).toBe("há 3 dias");
    expect(relativeDue("2026-08-24", today)).toBe("em 5 dias");
  });

  it("desiste além de 30 dias em vez de dizer 'em 400 dias'", () => {
    expect(relativeDue("2027-08-19", today)).toBeNull();
  });

  it("não inventa texto sem data", () => {
    expect(relativeDue(null, today)).toBeNull();
  });
});

describe("formatPeriod", () => {
  it("mostra início e fim quando é um período", () => {
    expect(formatPeriod("2026-08-01", "2026-08-15")).toBe(`${formatShortDate("2026-08-01")} → ${formatShortDate("2026-08-15")}`);
  });

  // Meia informação de período parece bug; uma ponta só já é o prazo normal.
  it("retorna null quando falta uma das pontas", () => {
    expect(formatPeriod("2026-08-01", null)).toBeNull();
    expect(formatPeriod(null, "2026-08-15")).toBeNull();
    expect(formatPeriod(null, null)).toBeNull();
  });

  // "12 ago → 12 ago" não é período: é a mesma data repetida ao lado do prazo
  // que o card já mostra.
  it("retorna null quando início e fim são a mesma data", () => {
    expect(formatPeriod("2026-08-12", "2026-08-12")).toBeNull();
  });

  // Caso real: 47 das 76 tarefas com start+end em produção têm
  // start === end === due_date. O card mostrava duas datas para uma data só.
  it("não repete a data de uma tarefa de dia único (caso de produção)", () => {
    const dia = "2026-08-22"; // "Reels Karpinski - Postagem 22/08"
    expect(formatPeriod(dia, dia)).toBeNull();
    // Um intervalo de verdade continua aparecendo.
    expect(formatPeriod("2026-08-01", "2026-08-31")).not.toBeNull();
  });
});

describe("isOverdue", () => {
  const today = "2026-08-19";

  it("marca atraso só depois do vencimento", () => {
    expect(isOverdue("2026-08-18", today, "em_producao")).toBe(true);
    expect(isOverdue("2026-08-19", today, "em_producao")).toBe(false);
    expect(isOverdue("2026-08-20", today, "em_producao")).toBe(false);
  });

  it("não cobra prazo de card já entregue", () => {
    expect(isOverdue("2026-08-01", today, "aprovado")).toBe(false);
    expect(isOverdue("2026-08-01", today, "concluido")).toBe(false);
  });

  it("continua cobrando enquanto o card está em revisão ou aprovação", () => {
    expect(isOverdue("2026-08-01", today, "revisao")).toBe(true);
    expect(isOverdue("2026-08-01", today, "aprovacao")).toBe(true);
  });

  it("card sem prazo nunca está atrasado", () => {
    expect(isOverdue(null, today, "backlog")).toBe(false);
  });
});

// O "hoje" que alimenta isOverdue/relativeDue precisa ser o de São Paulo: o
// servidor roda em UTC, então às 21h BRT já é o dia seguinte lá e tudo
// apareceria atrasado três horas antes da hora.
describe("hoje em São Paulo", () => {
  it("às 21h BRT ainda é o mesmo dia (UTC já virou)", () => {
    const noite = new Date("2026-08-19T23:30:00.000Z"); // 20h30 BRT
    expect(todayInTimezone("America/Sao_Paulo", noite)).toBe("2026-08-19");
    expect(new Date(noite).toISOString().slice(0, 10)).toBe("2026-08-19");

    const depoisDaMeiaNoiteUtc = new Date("2026-08-20T02:00:00.000Z"); // 23h BRT do dia 19
    expect(todayInTimezone("America/Sao_Paulo", depoisDaMeiaNoiteUtc)).toBe("2026-08-19");
    // Provando o bug que a função evita: em UTC cru já seria dia 20.
    expect(depoisDaMeiaNoiteUtc.toISOString().slice(0, 10)).toBe("2026-08-20");
  });

  it("um card que vence hoje não fica atrasado às 23h BRT", () => {
    const today = todayInTimezone("America/Sao_Paulo", new Date("2026-08-20T02:00:00.000Z"));
    expect(isOverdue("2026-08-19", today, "em_producao")).toBe(false);
  });
});
