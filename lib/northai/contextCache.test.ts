import { describe, expect, it } from "vitest";
import { cacheFail, cacheResolve, cacheStart, type ContextCache } from "./contextCache";

describe("cache de contexto", () => {
  it("seleção rápida Tock → Baita: a resposta atrasada da Tock não aparece na Baita", () => {
    let cache: ContextCache<string> = {};
    cache = cacheStart(cache, "tock", 1);
    cache = cacheStart(cache, "baita", 2);
    cache = cacheResolve(cache, "baita", 2, "contexto da Baita");
    cache = cacheResolve(cache, "tock", 1, "contexto da Tock");
    // a tela mostra o cliente escolhido por último
    expect(cache.baita.data).toBe("contexto da Baita");
    expect(cache.tock.data).toBe("contexto da Tock");
  });

  it("uma requisição antiga do MESMO cliente é ignorada depois de recarregar", () => {
    let cache: ContextCache<string> = {};
    cache = cacheStart(cache, "tock", 1);
    cache = cacheStart(cache, "tock", 2);
    cache = cacheResolve(cache, "tock", 1, "velho");
    expect(cache.tock.status).toBe("loading");
    cache = cacheResolve(cache, "tock", 2, "novo");
    expect(cache.tock).toMatchObject({ status: "ready", data: "novo" });
  });

  it("recarregar mantém o dado anterior; falha guarda o erro sem apagar o dado", () => {
    let cache: ContextCache<string> = { tock: { status: "ready", data: "antes", error: null, requestId: 1 } };
    cache = cacheStart(cache, "tock", 2);
    expect(cache.tock.data).toBe("antes");
    cache = cacheFail(cache, "tock", 2, "503");
    expect(cache.tock).toMatchObject({ status: "error", data: "antes", error: "503" });
  });
});
