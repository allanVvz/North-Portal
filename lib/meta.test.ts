import { describe, expect, it } from "vitest";
import { metaErrorMessage } from "./meta";

// O caso real: em 21/09/2026 os relatórios de 3 clientes pararam com o texto cru
// da Meta em inglês, que não dizia a quem recorrer. A Meta manda checkpoint como
// OAuthException em HTTP 400 — nunca 401 —, então o que se prova aqui é que o
// STATUS não decide nada: quem decide é o corpo.
const checkpointBody = {
  error: {
    message: "You cannot access the app till you log in to www.facebook.com and follow the instructions given.",
    type: "OAuthException",
    code: 190,
    error_subcode: 459,
  },
};

describe("metaErrorMessage", () => {
  it("reconhece checkpoint em HTTP 400 e diz o que fazer", () => {
    const message = metaErrorMessage(400, checkpointBody);
    expect(message).toContain("verificação de segurança");
    expect(message).toContain("www.facebook.com");
    // O texto original da Meta fica no fim: é como se acha o código exato depois.
    expect(message).toContain("You cannot access the app");
  });

  it("reconhece checkpoint pelo texto mesmo sem subcódigo", () => {
    const message = metaErrorMessage(400, { error: { message: "You cannot access the app till you log in to www.facebook.com and follow the instructions given." } });
    expect(message).toContain("verificação de segurança");
  });

  it("separa token expirado de checkpoint", () => {
    const message = metaErrorMessage(400, { error: { message: "Error validating access token: Session has expired", code: 190, error_subcode: 463 } });
    // 463 está na faixa de checkpoint/expiração que exige ação na conta.
    expect(message).toContain("verificação de segurança");
    expect(metaErrorMessage(401, { error: { message: "Invalid OAuth token", code: 190 } })).toContain("reconecte a integração");
  });

  it("reconhece bloqueio por política, limite de chamadas e volume de dados", () => {
    expect(metaErrorMessage(400, { error: { message: "blocked", code: 368 } })).toContain("violação de política");
    expect(metaErrorMessage(400, { error: { message: "limit", code: 17 } })).toContain("Limite de chamadas");
    expect(metaErrorMessage(400, { error: { message: "too much", code: 1, error_subcode: 99 } })).toContain("volume de dados");
  });

  it("repassa o que não reconhece, sem inventar diagnóstico", () => {
    expect(metaErrorMessage(500, { error: { message: "Service temporarily unavailable", code: 2 } }))
      .toBe("A Meta respondeu com erro: Service temporarily unavailable");
    expect(metaErrorMessage(503, null)).toBe("A Meta respondeu com erro (503).");
  });
});
