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

  it("preserva seguidores novos e custo declarados no resumo operacional", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("66 novos seguidores\nCusto por novo seguidor: R$ 1,07", "2026-09-18T10:00:00.000Z", "conversao"),
    ], tags);

    expect(result.seguidoresGanho).toBe(66);
    expect(result.custoPorNovoSeguidor).toBe(1.07);
    expect(result.interpretation.claims).toContainEqual(expect.objectContaining({ metric: "custo_por_novo_seguidor", value: 1.07 }));
  });

  it("leva a análise operacional para uma leitura curta do relatório", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("Tivemos a atenção dividida entre vídeo de apresentação da Baita e vídeo sobre dia do cliente. Tivemos total de 66 novos seguidores.", "2026-09-18T10:00:00.000Z"),
    ], tags);

    expect(result.seguidoresGanho).toBe(66);
    expect(result.interpretation.context).toEqual([
      expect.objectContaining({ text: "Tivemos a atenção dividida entre vídeo de apresentação da Baita e vídeo sobre dia do cliente." }),
    ]);
  });

  it("não repete os números na leitura quando a análise geral já os contextualiza", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment("Análise Geral\nNesta semana, as duas campanhas seguiram trabalhando em conjunto: perfil ampliando a audiência, enquanto mensagens geram oportunidades diretas. A campanha de perfil trouxe 66 novos seguidores.", "2026-09-18T10:00:00.000Z"),
    ], tags);

    expect(result.interpretation.context[0]?.text).toBe("Nesta semana, as duas campanhas seguiram trabalhando em conjunto: perfil ampliando a audiência, enquanto mensagens geram oportunidades diretas.");
  });

  it("não duplica o pedido 'ajuste o comentário' como contexto — ele já virou narrativa em outro lugar", async () => {
    const result = await consolidateAdaptiveFeedback([
      comment(
        "Ajuste o comentário: Direcionamos as campanhas de trafego para perfil e para o site para regiões das capitais de SC e PR também, buscando alcançar pessoas mais de longe. Remova o comentário sobre seguidores novos. e retire dos dados o % comparativo com o período anterior",
        "2026-09-22T19:20:34.334993+00:00",
        "conversao",
      ),
    ], tags);

    expect(result.interpretation.context).toEqual([]);
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
