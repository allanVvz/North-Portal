import { describe, expect, it } from "vitest";
import { consolidateAdaptiveFeedback, fingerprintComments, intentOf, precisionOf, type SourcedComment } from "./adaptiveFeedback";

const tags = ["vendas", "agendamentos", "receita", "seguidores"];
const comment = (text: string, at: string, taskId = "feedback"): SourcedComment => ({ author: "Luiza", text, at, taskId });

describe("consolidateAdaptiveFeedback", () => {
  it("aplica uma correção parcial sem perder as métricas já registradas", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("Vendas: 5\nReceita: R$ 4.100\nAgendamentos: 8", "2026-09-18T10:00:00.000Z"),
      comment("Corrigindo: Vendas: 4", "2026-09-18T11:00:00.000Z", "conversao"),
    ], tags);

    expect(result.valores).toMatchObject({ vendas: 4, receita: 4100, agendamentos: 8 });
    expect(result.interpretation.claims.find((claim) => claim.metric === "vendas")?.sourceTaskId).toBe("conversao");
    expect(result.interpretation.tradeoffs).toEqual([]);
  });

  it("preserva o contexto humano sem transformá-lo em uma métrica ou causalidade", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("Vendas: 2", "2026-09-18T10:00:00.000Z"),
      comment("O foco do período foi a divulgação do evento e alcance.", "2026-09-18T11:00:00.000Z", "conversao"),
    ], tags);

    expect(result.valores.vendas).toBe(2);
    expect(result.interpretation.context).toEqual([expect.objectContaining({ author: "Luiza", text: expect.stringContaining("divulgação do evento") })]);
  });

  it("mantém aproximações como canônicas, mas com a precisão correta", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("Foram cerca de 8 vendas.", "2026-09-18T10:00:00.000Z"),
    ], tags);

    expect(result.valores.vendas).toBe(8);
    expect(result.interpretation.claims.find((claim) => claim.metric === "vendas")).toMatchObject({ precision: "aproximada", confidence: "baixa" });
  });

  it("combina ganho declarado com snapshot posterior do total do perfil", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("47 seguidores novos", "2026-09-18T10:00:00.000Z"),
      comment("No período anterior com 7953 seguidores e atualmente com 8000 seguidores", "2026-09-18T11:00:00.000Z", "conversao"),
    ], tags);

    expect(result.seguidoresGanho).toBe(47);
    expect(result.valores.seguidores).toBe(8000);
    expect(result.valoresAnteriores?.seguidores).toBe(7953);
  });

  it("registra o trade-off quando um valor mais recente diverge sem correção explícita", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("Vendas: 5", "2026-09-18T10:00:00.000Z"),
      comment("Vendas: 4", "2026-09-18T11:00:00.000Z", "conversao"),
    ], tags);

    expect(result.valores.vendas).toBe(4);
    expect(result.interpretation.tradeoffs.join(" ")).toContain("usei 4 do comentário mais recente");
  });

  it("faz a impressão digital mudar para edição, exclusão ou novo contexto", () => {
    const base = [comment("Vendas: 5", "2026-09-18T10:00:00.000Z")];
    const edited = [{ ...base[0], text: "Vendas: 4", edited_at: "2026-09-18T10:02:00.000Z" }];
    expect(fingerprintComments(base)).not.toBe(fingerprintComments(edited));
    expect(intentOf("gere novamente considerando a correção")).toBe("misto");
    expect(precisionOf("entre 4 e 6 vendas")).toBe("faixa");
  });
});
