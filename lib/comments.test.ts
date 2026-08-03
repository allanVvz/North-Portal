import { describe, expect, it } from "vitest";
import { extractLatestLink, formatCommentTime, splitCommentText } from "./comments";

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
