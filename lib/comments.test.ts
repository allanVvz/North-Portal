import { describe, expect, it } from "vitest";
import { extractLatestLink, familyThreadOf, formatCommentTime, formatRelativeAge, isFamilyParent, mergeFamilyComments, splitCommentText } from "./comments";

describe("splitCommentText", () => {
  it("mantém texto sem link como um único segmento", () => {
    expect(splitCommentText("sem link aqui")).toEqual([{ text: "sem link aqui" }]);
  });

  it("isola um link no meio do texto", () => {
    expect(splitCommentText("veja https://exemplo.com/x e confirma")).toEqual([
      { text: "veja " },
      { url: "https://exemplo.com/x" },
      { text: " e confirma" },
    ]);
  });

  it("isola múltiplos links", () => {
    expect(splitCommentText("https://a.com https://b.com")).toEqual([
      { url: "https://a.com" },
      { text: " " },
      { url: "https://b.com" },
    ]);
  });

  it("isola um link no final do texto", () => {
    expect(splitCommentText("material em https://exemplo.com/y")).toEqual([
      { text: "material em " },
      { url: "https://exemplo.com/y" },
    ]);
  });

  it("reconhece a forma curta [label](url) com o nome do arquivo", () => {
    expect(splitCommentText("Relatório gerado: [relatorio.pdf](https://exemplo.com/relatorio.pdf)")).toEqual([
      { text: "Relatório gerado: " },
      { url: "https://exemplo.com/relatorio.pdf", label: "relatorio.pdf" },
    ]);
  });

  it("mistura link curto e link cru no mesmo texto", () => {
    expect(splitCommentText("[a.pdf](https://x.com/a.pdf) e também https://x.com/b")).toEqual([
      { url: "https://x.com/a.pdf", label: "a.pdf" },
      { text: " e também " },
      { url: "https://x.com/b" },
    ]);
  });
});

describe("extractLatestLink", () => {
  it("pega o link do comentário mais recente que tiver um", () => {
    const comments = [
      { author: "A", text: "sem link", at: "2026-08-01T00:00:00Z" },
      { author: "B", text: "https://antigo.com", at: "2026-08-02T00:00:00Z" },
      { author: "C", text: "só texto", at: "2026-08-03T00:00:00Z" },
    ];
    expect(extractLatestLink(comments)).toBe("https://antigo.com");
  });

  it("retorna null quando nenhum comentário tem link", () => {
    expect(extractLatestLink([{ author: "A", text: "oi", at: "2026-08-01T00:00:00Z" }])).toBeNull();
  });
});

describe("mergeFamilyComments", () => {
  const pai = {
    id: "pai",
    payload: { comments: [{ author: "A", text: "abertura", at: "2026-08-01T09:00:00Z" }] },
  };
  const etapa1 = {
    id: "e1",
    payload: {
      comments: [
        { author: "B", text: "roteiro pronto", at: "2026-08-02T10:00:00Z" },
        { author: "C", text: "ajuste", at: "2026-08-04T10:00:00Z" },
      ],
    },
  };
  const etapa2 = { id: "e2", payload: { comments: [{ author: "D", text: "captação", at: "2026-08-03T10:00:00Z" }] } };

  it("intercala os comentários de todos os cards por data", () => {
    const merged = mergeFamilyComments([pai, etapa1, etapa2]);
    expect(merged.map((c) => c.text)).toEqual(["abertura", "roteiro pronto", "captação", "ajuste"]);
  });

  it("marca cada comentário com o card de origem", () => {
    const merged = mergeFamilyComments([pai, etapa1, etapa2]);
    expect(merged.map((c) => c.taskId)).toEqual(["pai", "e1", "e2", "e1"]);
  });

  // A RPC grava `at` como "2026-08-24 11:43:00+00" (timestamptz::text) e o JS
  // grava "2026-08-24T11:43:00.000Z" (ISO). Comparar como string ordenava por
  // formato — o comentário antigo do plano ficava preso no topo.
  it("ordena por data mesmo com formatos de `at` misturados", () => {
    const planoAntigo = {
      id: "plano",
      payload: { comments: [{ author: "A", text: "kickoff do plano", at: "2026-08-01T09:00:00.000Z" }] },
    };
    const atividadeNova = {
      id: "ativ",
      payload: { comments: [{ author: "B", text: "entreguei hoje", at: "2026-08-20 14:30:00+00" }] },
    };
    const merged = mergeFamilyComments([planoAntigo, atividadeNova]);
    expect(merged.map((c) => c.text)).toEqual(["kickoff do plano", "entreguei hoje"]);
  });

  it("data ilegível não quebra a ordenação", () => {
    const merged = mergeFamilyComments([
      { id: "a", payload: { comments: [{ author: "A", text: "ok", at: "não é data" }] } },
      { id: "b", payload: { comments: [{ author: "B", text: "depois", at: "2026-08-10T10:00:00Z" }] } },
    ]);
    expect(merged.map((c) => c.text)).toEqual(["ok", "depois"]);
  });

  it("ignora card sem payload.comments e lista vazia", () => {
    expect(mergeFamilyComments([{ id: "x", payload: null }, { id: "y", payload: {} }])).toEqual([]);
    expect(mergeFamilyComments([])).toEqual([]);
  });
});

// A regra de QUEM mescla morava dentro do TaskModal, então só o modal a tinha:
// o painel lateral (para onde o link `?task=` leva quando a preferência de
// painel lateral está ligada) mostrava só os comentários do próprio card. Abrir
// o mesmo card por portas diferentes devolvia threads diferentes.
describe("familyThreadOf", () => {
  const elo = (id: string, slot: string | null, position = 0) => ({ id, slot, position });
  const card = (id: string, kind: string, comments: unknown[], extra: Record<string, unknown> = {}) => ({
    id,
    kind,
    payload: { comments, ...extra },
    parents: [] as ReturnType<typeof elo>[],
  });

  const entrega = card("entrega", "criativo", [{ author: "A", text: "briefing", at: "2026-09-01T09:00:00Z" }], { flow_parent: true });
  const roteiro = { ...card("roteiro", "criativo", [{ author: "B", text: "roteiro ok", at: "2026-09-02T09:00:00Z" }]), parents: [elo("entrega", "roteiro", 10)] };
  const captacao = { ...card("captacao", "criativo", [{ author: "C", text: "gravado", at: "2026-09-03T09:00:00Z" }]), parents: [elo("entrega", "captacao", 20)] };
  const avulso = card("avulso", "criativo", [{ author: "D", text: "nada a ver", at: "2026-09-04T09:00:00Z" }]);
  const quadro = [entrega, roteiro, captacao, avulso];

  it("a entrega mostra os comentários dela e das etapas, em ordem", () => {
    expect(familyThreadOf(entrega, quadro).map((c) => c.text)).toEqual(["briefing", "roteiro ok", "gravado"]);
  });

  it("a etapa mostra só os próprios comentários", () => {
    expect(familyThreadOf(roteiro, quadro).map((c) => c.text)).toEqual(["roteiro ok"]);
  });

  it("todo comentário sai marcado com o card de origem, mesclado ou não", () => {
    expect(familyThreadOf(entrega, quadro).map((c) => c.taskId)).toEqual(["entrega", "roteiro", "captacao"]);
    expect(familyThreadOf(roteiro, quadro).map((c) => c.taskId)).toEqual(["roteiro"]);
  });

  it("um Plano de Ação mostra ele + as atividades, ligadas SEM slot", () => {
    const plano = card("plano", "plano_acao", [{ author: "A", text: "escopo", at: "2026-09-01T09:00:00Z" }]);
    const atividade = { ...card("ativ", "criativo", [{ author: "B", text: "feito", at: "2026-09-02T09:00:00Z" }]), parents: [elo("plano", null)] };
    expect(familyThreadOf(plano, [plano, atividade]).map((c) => c.text)).toEqual(["escopo", "feito"]);
  });

  // Um card comum não vira pai por acidente: `flow_parent` é marca explícita,
  // e há cards `criativo` legados que são trabalho comum.
  it("card comum não mescla nada", () => {
    expect(isFamilyParent(avulso)).toBe(false);
    expect(familyThreadOf(avulso, quadro).map((c) => c.text)).toEqual(["nada a ver"]);
  });

  // O editor pergunta pelo tipo do RASCUNHO: trocar o tipo no formulário
  // reflete no thread antes de salvar.
  it("aceita um tipo diferente do salvo, para o formulário em edição", () => {
    const salvoComum = card("x", "criativo", [{ author: "A", text: "meu", at: "2026-09-01T09:00:00Z" }]);
    const atividade = { ...card("y", "criativo", [{ author: "B", text: "do filho", at: "2026-09-02T09:00:00Z" }]), parents: [elo("x", null)] };
    expect(familyThreadOf(salvoComum, [salvoComum, atividade], "plano_acao").map((c) => c.text)).toEqual(["meu", "do filho"]);
  });
});

describe("formatCommentTime", () => {
  const now = new Date("2026-08-03T12:00:00Z").getTime();

  it("mostra 'agora' pra menos de um minuto", () => {
    expect(formatCommentTime(new Date(now - 30000).toISOString(), now)).toBe("agora");
  });

  it("mostra minutos dentro da primeira hora", () => {
    expect(formatCommentTime(new Date(now - 5 * 60000).toISOString(), now)).toBe("há 5 min");
  });

  it("mostra horas dentro das primeiras 24h", () => {
    expect(formatCommentTime(new Date(now - 5 * 3.6e6).toISOString(), now)).toBe("há 5 h");
  });

  it("vira data/hora absoluta a partir de 24h", () => {
    const iso = new Date(now - 25 * 3.6e6).toISOString();
    expect(formatCommentTime(iso, now)).toBe(
      `${new Date(iso).toLocaleDateString("pt-BR")} ${new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    );
  });
});

// O carimbo do card do quadro é sinal de frescor, não registro: sempre
// relativo, sempre curto. É o que impede ele de voltar a competir com o prazo.
describe("formatRelativeAge", () => {
  const agora = Date.UTC(2026, 7, 30, 12, 0, 0);
  const atras = (ms: number) => new Date(agora - ms).toISOString();

  it("nunca devolve data absoluta, por mais velho que seja", () => {
    expect(formatRelativeAge(atras(400 * 86400000), agora)).toBe("há 13 m");
    expect(formatRelativeAge(atras(400 * 86400000), agora)).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("encurta conforme a idade cresce", () => {
    expect(formatRelativeAge(atras(30_000), agora)).toBe("agora");
    expect(formatRelativeAge(atras(5 * 60_000), agora)).toBe("há 5 min");
    expect(formatRelativeAge(atras(8 * 3.6e6), agora)).toBe("há 8 h");
    expect(formatRelativeAge(atras(3 * 86400000), agora)).toBe("há 3 d");
    expect(formatRelativeAge(atras(21 * 86400000), agora)).toBe("há 3 sem");
  });

  it("data inválida vira string vazia em vez de NaN na tela", () => {
    expect(formatRelativeAge("não é data", agora)).toBe("");
  });
});
