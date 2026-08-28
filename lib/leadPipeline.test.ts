import { describe, expect, it } from "vitest";
import {
  LEAD_STATUS_ORDER, canMoveFrom, canSetManually, canTransition,
  investmentRank, isLeadStatus, leadStatusOf,
} from "./leadPipeline";

describe("leadPipeline", () => {
  it("descarte fica no fim da ordem, não no meio do avanço", () => {
    expect(LEAD_STATUS_ORDER).toEqual(["novo", "contatado", "qualificado", "convertido", "descartado"]);
  });

  it("nunca propaga um status desconhecido", () => {
    // Uma linha antiga do banco, ou a resposta de um CRM com vocabulário
    // próprio, não pode virar uma coluna fantasma no quadro.
    expect(leadStatusOf("won")).toBe("novo");
    expect(leadStatusOf(null)).toBe("novo");
    expect(leadStatusOf(undefined)).toBe("novo");
    expect(leadStatusOf(42)).toBe("novo");
    expect(leadStatusOf("qualificado")).toBe("qualificado");
    expect(isLeadStatus("qualificado")).toBe(true);
    expect(isLeadStatus("won")).toBe(false);
  });

  it("a tela não concede 'convertido' — só o fluxo de criação de cliente", () => {
    expect(canSetManually("convertido")).toBe(false);
    expect(canSetManually("qualificado")).toBe(true);
    expect(canTransition("qualificado", "convertido")).toBe(false);
  });

  it("um lead convertido está encerrado e não volta atrás", () => {
    expect(canMoveFrom("convertido")).toBe(false);
    for (const status of LEAD_STATUS_ORDER) {
      expect(canTransition("convertido", status)).toBe(false);
    }
  });

  it("permite avançar e retroceder entre os status manuais", () => {
    expect(canTransition("novo", "contatado")).toBe(true);
    expect(canTransition("qualificado", "novo")).toBe(true);
    expect(canTransition("contatado", "descartado")).toBe(true);
    expect(canTransition("descartado", "contatado")).toBe(true);
  });

  it("mover para o mesmo status não é transição", () => {
    expect(canTransition("novo", "novo")).toBe(false);
  });

  it("ordena as faixas de investimento e ignora valor fora do enum", () => {
    expect(investmentRank("12k+")).toBeGreaterThan(investmentRank("até-3k"));
    expect(investmentRank("6k-12k")).toBeGreaterThan(investmentRank("3k-6k"));
    // -1 joga o desconhecido para o fim da lista ordenada por desc, em vez de
    // fingir que é a menor faixa válida.
    expect(investmentRank("outra")).toBe(-1);
  });
});
