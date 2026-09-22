import { describe, expect, it } from "vitest";
import { feedbackTemplate, parseFeedbackComment } from "./commentParser";
import { CONVERSION_METRICS_DEFAULT, COMMENT_ONLY_METRIC_TAGS, metricTagDef } from "@/lib/metricTags";

// O que a Marketing API não entrega, a automação PEDE no comentário. Verba
// disponível é o primeiro caso: a operação precisa do número no resumo semanal e
// não existe campo de insights que o traga. Este arquivo prova o caminho inteiro
// — pedido, leitura e rótulo — sem depender de IA.

const TAGS = [...CONVERSION_METRICS_DEFAULT, "verba_disponivel"];

describe("verba disponível — pedida pelo comentário", () => {
  it("entra no modelo que o pedido de feedback mostra", () => {
    expect(feedbackTemplate(TAGS)).toContain("Verba disponível: R$ 1.200");
  });

  it("fica FORA do pedido padrão: só quem configurou a tag é cobrado", () => {
    expect(CONVERSION_METRICS_DEFAULT).not.toContain("verba_disponivel");
    expect(feedbackTemplate(CONVERSION_METRICS_DEFAULT)).not.toContain("Verba");
  });

  it("é lida do comentário no formato do modelo", () => {
    const r = parseFeedbackComment("Vendas: 5\nReceita: R$ 4.100\nVerba disponível: R$ 1.200", TAGS);
    expect(r.valores.verba_disponivel).toBe(1200);
    expect(r.valores.vendas).toBe(5);
    expect(r.valores.receita).toBe(4100);
  });

  it("é lida em texto corrido, com os apelidos que a operação usa", () => {
    for (const texto of ["ainda temos R$ 850 de verba", "saldo de verba: 850", "verba restante 850"]) {
      expect(parseFeedbackComment(texto, TAGS).valores.verba_disponivel).toBe(850);
    }
  });

  it('"orçamento" continua sendo agendamento, não verba', () => {
    // As duas listas de apelidos não podem compartilhar palavra: "orçamento
    // enviado ao cliente" é agendamento na operação.
    const r = parseFeedbackComment("Orçamentos: 8", TAGS);
    expect(r.valores.agendamentos).toBe(8);
    expect(r.valores.verba_disponivel).toBeNull();
  });

  it("rótulo e tipo saem do catálogo, para o relatório formatar como dinheiro", () => {
    expect(metricTagDef("verba_disponivel")).toEqual({ key: "verba_disponivel", label: "Verba disponível", kind: "money" });
    expect(COMMENT_ONLY_METRIC_TAGS.has("verba_disponivel")).toBe(true);
    expect(COMMENT_ONLY_METRIC_TAGS.has("seguidores")).toBe(true);
  });

  it("não informada é null, nunca zero", () => {
    const r = parseFeedbackComment("Vendas: 5", TAGS);
    expect(r.valores.verba_disponivel).toBeNull();
  });
});
