import { describe, expect, it } from "vitest";
import { BOTTOM_W, TAPER_MAX, funnelBandLayout, funnelBandWidths, funnelChartHeight, funnelStageCount } from "./funnelGeometry";

describe("funnelStageCount", () => {
  it("derruba a etapa de cauda null ou 0, nunca abaixo de 2", () => {
    expect(funnelStageCount([100, 50, 10])).toBe(3);
    expect(funnelStageCount([100, 50, 10, null])).toBe(3);
    expect(funnelStageCount([100, 50, 10, 0])).toBe(3);
    expect(funnelStageCount([100, 50, null, null])).toBe(2);
    expect(funnelStageCount([null, null])).toBe(2);
    // cauda vazia no meio não é cauda — só a última conta
    expect(funnelStageCount([100, null, 10])).toBe(3);
  });
});

describe("funnelBandWidths", () => {
  it("base = 1 e cada etapa fica sob o teto do taper (razões reais de produção)", () => {
    const w = funnelBandWidths([15100, 248, 39]);
    expect(w[0]).toBeCloseTo(1);
    expect(w[1]).toBeLessThanOrEqual(w[0] * TAPER_MAX + 1e-9);
    expect(w[2]).toBeLessThanOrEqual(w[1] * TAPER_MAX + 1e-9);
    for (const x of w) expect(Number.isFinite(x)).toBe(true);
  });

  it("etapa sem dado vira largura mínima fixa", () => {
    expect(funnelBandWidths([1000, null, 40])[1]).toBe(BOTTOM_W);
  });

  it("all-null (inclusive base nula) não lança e sai tudo finito", () => {
    const w = funnelBandWidths([null, null, null]);
    expect(w).toHaveLength(3);
    for (const x of w) expect(Number.isFinite(x)).toBe(true);
  });

  it("etapas todas iguais → cilindro capado pelo taper", () => {
    const w = funnelBandWidths([100, 100, 100]);
    expect(w[0]).toBe(1);
    expect(w[1]).toBeCloseTo(TAPER_MAX);
    expect(w[2]).toBeCloseTo(TAPER_MAX * TAPER_MAX);
  });

  it("par único", () => {
    expect(funnelBandWidths([500, 500])).toHaveLength(2);
  });

  it("base 0 se comporta como base nula", () => {
    for (const x of funnelBandWidths([0, 10, 5])) expect(Number.isFinite(x)).toBe(true);
  });
});

describe("funnelChartHeight", () => {
  it("N etapas = N*BAND_H + (N-1)*BAND_GAP", () => {
    expect(funnelChartHeight(3)).toBe(3 * 60 + 2 * 23);
    expect(funnelChartHeight(1)).toBe(60);
    expect(funnelChartHeight(0)).toBe(0);
  });
});

describe("funnelBandLayout", () => {
  it("uma banda por valor, trapézio e leader como string, taxa só entre etapas", () => {
    const bands = funnelBandLayout([15100, 248, 39]);
    expect(bands).toHaveLength(3);
    expect(bands[0].trapezoid.startsWith("M")).toBe(true);
    expect(bands[0].leader.startsWith("M")).toBe(true);
    expect(bands[0].rateAt).not.toBeNull();
    expect(bands[2].rateAt).toBeNull();
    expect(bands[1].missing).toBe(false);
  });

  it("marca missing na etapa sem dado", () => {
    const bands = funnelBandLayout([1000, null, 40]);
    expect(bands[1].missing).toBe(true);
    expect(bands[1].opacity).toBe(1);
    expect(bands[0].opacity).toBeCloseTo(1);
    expect(bands[2].opacity).toBeCloseTo(1 - 2 * 0.12);
  });
});
