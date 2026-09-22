import { describe, expect, it } from "vitest";
import { parseFeedbackComment } from "./commentParser";

// Os comentários REAIS da semana 15–21/09, copiados do banco. Cada um escreveu a
// mesma métrica de um jeito, e os três produziram resultados diferentes:
//
//   Baita  → seguidores 8066 / novos 66   (certo)
//   CRIS   → {} — os seguidores sumiram do PDF
//   FALKE  → seguidores 66 / novos 66     (e o PDF chamou 66 de "Total do perfil")
//
// A regra confirmada com o usuário: o número informado é SEMPRE o ganho
// ("seguidores adquiridos"); o total do perfil só existe quando a pessoa disser
// os dois. Ausência nunca vira zero.

const TAGS = ["vendas", "agendamentos", "seguidores", "receita"];

describe("comentários reais de 15–21/09", () => {
  // O caso que sumiu do PDF: o ganho e a base do perfil na mesma frase. Antes o
  // parser via 21 e 30000 como dois valores da mesma métrica, marcava AMBIGUOUS
  // e descartava os dois.
  it("CRIS: '21 novos seguidores. O perfil já estava com mias de 30000 seguidores'", () => {
    const r = parseFeedbackComment("21 novos seguidores. O perfil já estava com mias de 30000 seguidores", TAGS);
    expect(r.state).not.toBe("AMBIGUOUS");
    expect(r.seguidoresGanho).toBe(21);
    expect(r.valores.seguidores).toBe(21);
    expect(r.valoresAnteriores.seguidores).toBe(30000);
  });

  // Mesmo formato, com erro de digitação na palavra depois do número
  // ("seguidres") — é por isso que a base não exige a palavra ao lado.
  it("Baita: '66 novos seguidores. O perfil já estava com mais de 8000 seguidres'", () => {
    const r = parseFeedbackComment(
      "Tivemos a atenção dividida entre vídeo de apresentação da Baita e vídeo sobre dia do cliente. Tivemos total de 66 novos seguidores. O perfil já estava com mais de 8000 seguidres",
      TAGS,
    );
    expect(r.seguidoresGanho).toBe(66);
    expect(r.valores.seguidores).toBe(66);
    expect(r.valoresAnteriores.seguidores).toBe(8000);
  });

  it("Baita (2º comentário): dois totais → total atual e anterior, sem ganho declarado", () => {
    const r = parseFeedbackComment("tinhamos 8000 seguidores e alcançamos 8066", TAGS);
    expect(r.valores.seguidores).toBe(8066);
    expect(r.valoresAnteriores.seguidores).toBe(8000);
  });

  it("FALKE: '66 novos seguidores' no resumo do WhatsApp é ganho", () => {
    const r = parseFeedbackComment(
      "162 visitas ao perfil. Custo por visita: R$ 0,44. Investimento: R$ 70,54. Alcance: 5.976 pessoas. 66 novos seguidores. Custo por novo seguidor: R$ 1,07",
      TAGS,
    );
    expect(r.seguidoresGanho).toBe(66);
    expect(r.valores.seguidores).toBe(66);
    expect(r.custoPorNovoSeguidor).toBe(1.07);
    // Não há base informada: o relatório não pode chamar 66 de "Total do perfil".
    expect(r.valoresAnteriores.seguidores).toBeNull();
  });

  it("ausência continua ausência: nada informado não vira zero", () => {
    const r = parseFeedbackComment(
      "Direcionamos as campanhas de trafego para perfil e para o site para regiões das capitais de SC e PR também",
      TAGS,
    );
    expect(r.valores).toEqual({ vendas: null, agendamentos: null, seguidores: null, receita: null });
    expect(r.seguidoresGanho).toBeNull();
  });
});
