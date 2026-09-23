import { describe, expect, it } from "vitest";
import { describeInstructions, extractReportInstructions } from "./reportInstructions";

// O comentário real da Luiza no relatório da CRIS, 22/09 19:20 — o que motivou
// este módulo. Antes ele não virava pedido nenhum.
const COMENTARIO_CRIS = "Ajuste o comentário: Direcionamos as campanhas de trafego para perfil e para o site para regiões das capitais de SC e PR também, buscando alcançar pessoas mais de longe. Em ambos estamos apresentando a loja. Para engajamento local apenas para região de NH com as promoções com intuito de trazer até a loja física. Remova o comentário sobre seguidores novos. e retire dos dados o % comparativo com o período anterior";

describe("extractReportInstructions — o comentário da CRIS", () => {
  const r = extractReportInstructions(COMENTARIO_CRIS);

  // "Remova o comentário sobre seguidores novos" fala do TEXTO no fim do
  // relatório, não do dado: ela mandou o texto novo justamente para entrar no
  // lugar do antigo. Lido como "esconder seguidores", isso apagava o KPI e a
  // etapa do funil da CRIS a cada geração (corrigido em 23/09).
  it("lê duas instruções — o pedido sobre o comentário é a própria narrativa", () => {
    expect(r.instrucoes).toHaveLength(2);
    expect(r.naoEntendido).toEqual([]);
  });

  it("a narrativa é o texto dela, sem o prefixo da instrução", () => {
    const narrativa = r.instrucoes.find((i) => i.kind === "narrativa");
    expect(narrativa).toBeDefined();
    const texto = narrativa?.kind === "narrativa" ? narrativa.texto : "";
    expect(texto.startsWith("Direcionamos as campanhas")).toBe(true);
    expect(texto).not.toMatch(/ajuste o coment/i);
  });

  it("a narrativa termina antes do pedido de remoção", () => {
    const narrativa = r.instrucoes.find((i) => i.kind === "narrativa");
    const texto = narrativa?.kind === "narrativa" ? narrativa.texto : "";
    expect(texto).toContain("loja física");
    expect(texto).not.toMatch(/remova|retire/i);
  });

  it("só o % comparativo é escondido — seguidores é dado, não texto", () => {
    const alvos = r.instrucoes.filter((i) => i.kind === "esconder").map((i) => (i.kind === "esconder" ? i.alvo : ""));
    expect(alvos).toEqual(["percentual_comparativo"]);
  });

  it("a resposta é item a item, não uma frase pronta", () => {
    expect(describeInstructions(r)).toEqual([
      "Troquei a leitura do período pelo texto que você escreveu.",
      "Tirei o % comparativo com o período anterior.",
    ]);
  });
});

describe("extractReportInstructions — outras formas de pedir", () => {
  it("'retire o alcance' e 'remova as impressões'", () => {
    const r = extractReportInstructions("retire o alcance do relatório e remova as impressões");
    const alvos = r.instrucoes.map((i) => (i.kind === "esconder" ? i.alvo : i.kind));
    expect(alvos).toEqual(["alcance", "impressoes"]);
  });

  it("'substitua a análise por: ...' também troca a narrativa", () => {
    const r = extractReportInstructions("Substitua a análise por: a semana foi de reforço de marca");
    expect(r.instrucoes).toEqual([{ kind: "narrativa", texto: "a semana foi de reforço de marca" }]);
  });

  it("pedido que o módulo não entende volta para a resposta, sem ser engolido", () => {
    const r = extractReportInstructions("coloque o logo do cliente no rodapé");
    expect(r.instrucoes).toEqual([]);
    expect(r.naoEntendido).toHaveLength(1);
    expect(describeInstructions(r)[0]).toMatch(/^Não soube aplicar/);
  });

  it("comentário que não pede nada não vira instrução", () => {
    const r = extractReportInstructions("21 novos seguidores. O perfil já estava com mais de 30000 seguidores");
    expect(r.instrucoes).toEqual([]);
    expect(r.naoEntendido).toEqual([]);
  });

  it("aprovação simples não vira pedido", () => {
    expect(extractReportInstructions("aprovado")).toEqual({ instrucoes: [], naoEntendido: [] });
  });

  it("o mesmo alvo pedido duas vezes entra uma vez só", () => {
    const r = extractReportInstructions("remova o alcance. retire o alcance das boxes também");
    expect(r.instrucoes).toEqual([{ kind: "esconder", alvo: "alcance" }]);
  });

  // A distinção que o módulo precisa fazer: pedido sobre TEXTO × pedido sobre DADO.
  it("'remova o comentário sobre seguidores' sozinho não esconde dado — volta como não entendido", () => {
    const r = extractReportInstructions("remova o comentário sobre seguidores novos");
    expect(r.instrucoes).toEqual([]);
    expect(r.naoEntendido).toHaveLength(1);
  });

  it("'retire os seguidores' também não esconde: o dado é estrutural do objetivo de perfil", () => {
    const r = extractReportInstructions("retire os seguidores do relatório");
    expect(r.instrucoes.filter((i) => i.kind === "esconder")).toEqual([]);
  });
});
