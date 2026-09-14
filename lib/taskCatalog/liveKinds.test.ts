import { afterEach, describe, expect, it, vi } from "vitest";
import { getLiveKindDef, setLiveKinds, subscribeLiveKinds } from "./liveKinds";

// `useLiveKindsVersion` (o hook em si) não é testado aqui de propósito — o
// projeto não tem jsdom/@testing-library instalado (vitest.config.ts roda em
// `environment: "node"`), e adicionar essa dependência só para isto está fora
// do escopo desta feature. As funções puras abaixo são exatamente o que o
// hook usa por baixo, e cobrem o comportamento real do cache.
describe("liveKinds — cache ao vivo de identidade visual", () => {
  afterEach(() => setLiveKinds({}));

  it("set/get fazem ida e volta", () => {
    expect(getLiveKindDef("reels")).toBeUndefined();
    setLiveKinds({ reels: { label: "Reels", icon: "▶", tone: "purple", blurb: "", performance: true } });
    expect(getLiveKindDef("reels")).toEqual({ label: "Reels", icon: "▶", tone: "purple", blurb: "", performance: true });
  });

  it("um setLiveKinds novo SUBSTITUI o cache inteiro, não faz merge", () => {
    setLiveKinds({ reels: { label: "Reels", icon: "▶", tone: "purple", blurb: "", performance: true } });
    setLiveKinds({ carrossel: { label: "Carrossel", icon: "◫", tone: "blue", blurb: "", performance: true } });
    expect(getLiveKindDef("reels")).toBeUndefined();
    expect(getLiveKindDef("carrossel")).toBeDefined();
  });

  it("avisa quem assinou quando o cache muda", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveKinds(listener);
    setLiveKinds({ reels: { label: "Reels", icon: "▶", tone: "purple", blurb: "", performance: true } });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLiveKinds({});
    expect(listener).toHaveBeenCalledTimes(1); // não chama de novo depois de cancelar
  });
});
