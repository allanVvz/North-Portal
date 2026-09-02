import { describe, expect, it } from "vitest";
import { extractLatestLink, formatCommentTime, formatRelativeAge, mergeFamilyComments, splitCommentText } from "./comments";

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

  it("ignora card sem payload.comments e lista vazia", () => {
    expect(mergeFamilyComments([{ id: "x", payload: null }, { id: "y", payload: {} }])).toEqual([]);
    expect(mergeFamilyComments([])).toEqual([]);
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
