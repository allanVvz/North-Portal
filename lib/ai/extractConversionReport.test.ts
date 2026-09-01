import { describe, expect, it } from "vitest";
import { extractConversionReport, parseConversionJson } from "./extractConversionReport";

describe("parseConversionJson", () => {
  it("estrutura linhas válidas e descarta lixo", () => {
    const text = `Aqui está: {"conversoes":[
      {"servico":"Vitrificação","valor":1200,"fonte":"2","status":"fechado"},
      {"servico":"Polimento","valor":"R$ 400","fonte":"1","status":"agendado"},
      {"servico":null,"valor":null,"fonte":null,"status":null},
      {"servico":"PPF","valor":-5,"fonte":"9","status":"talvez"}
    ]}`;
    const { conversoes } = parseConversionJson(text);
    expect(conversoes).toEqual([
      { servico: "Vitrificação", valor: 1200, fonte: "2", status: "fechado" },
      { servico: "Polimento", valor: 400, fonte: "1", status: "agendado" },
      { servico: "PPF", valor: null, fonte: null, status: null },
    ]);
  });

  it("resposta sem JSON → vazio + note", () => {
    expect(parseConversionJson("não consegui").conversoes).toEqual([]);
    expect(parseConversionJson("não consegui").note).toBe("resposta da IA ilegível");
  });

  it("JSON sem chave conversoes → vazio", () => {
    expect(parseConversionJson('{"foo":1}').note).toBe("JSON sem conversoes");
  });
});

describe("extractConversionReport", () => {
  it("pré-check regex: 'N agendamentos' vira N linhas, sem chamar a IA", async () => {
    const { conversoes, note } = await extractConversionReport("fechamos 12 agendamentos");
    expect(note).toBe("regex");
    expect(conversoes).toHaveLength(12);
    expect(conversoes.every((c) => c.status === "agendado" && c.valor === null)).toBe(true);
  });

  it("degrada graciosamente sem provedor de IA configurado", async () => {
    const { conversoes, note } = await extractConversionReport("Vitrificação R$1200 #2 fechado; Polimento R$400 #1 agendado");
    expect(conversoes).toEqual([]);
    expect(note).toMatch(/IA indisponível/);
  });

  it("comentário vazio → vazio", async () => {
    expect((await extractConversionReport("   ")).conversoes).toEqual([]);
  });
});
