// FONTE ÚNICA da geometria do funil de aquisição.
//
// A forma do funil (largura de cada faixa) é PROPORCIONAL AOS DADOS, em escala
// logarítmica normalizada sobre o intervalo observado — as razões de um funil
// real percorrem ordens de grandeza (15.100 de alcance → 248 cliques → 39
// conversas), e só o log faz a forma voltar a ler como funil.
//
// Este arquivo existe porque a mesma geometria precisa rodar em DOIS
// renderizadores: o SVG da tela (`app/admin/performance/AcquisitionDashboard.tsx`
// `FunnelChart`) e o SVG do PDF da automação (`lib/reports/adsReportPdf.tsx`).
// Puro, sem imports — pode ser importado de qualquer lado (client, server, teste).

/** Largura da área de desenho do funil (o funil ocupa a faixa esquerda). */
export const FUNNEL_W = 182;
/** X onde começam os rótulos, FORA da forma, ligados por linha guia. */
export const LABEL_X = 202;
/** Largura total do SVG (funil + rótulos). */
export const CHART_W = 398;
/** Altura de cada faixa. */
export const BAND_H = 60;
/** Vão entre faixas (onde vive a taxa de conversão). */
export const BAND_GAP = 23;
/** Largura da etapa mais estreita do conjunto (fração de FUNNEL_W). */
export const BOTTOM_W = 0.2;
/** Teto de segurança: nenhuma etapa passa desta fração da anterior. */
export const TAPER_MAX = 0.62;

/**
 * Largura (0..1) de cada faixa. `values[0]` é a base (etapa do topo); a etapa
 * mais estreita assenta em `BOTTOM_W`, a mais larga em 1. Etapa sem dado
 * (`null`), `<= 0`, ou base nula/zero → largura mínima fixa. Funil de etapas
 * todas iguais (span 0) → cilindro (todas em 1, capadas depois pelo taper).
 *
 * Idêntico ao cálculo inline que estava em `FunnelChart` — NÃO mexer sem mexer
 * lá também (é o mesmo desenho nos dois lados).
 */
export function funnelBandWidths(values: readonly (number | null)[]): number[] {
  const base = values[0] ?? null;
  const logs = values.map((value) => {
    if (base === null || base === 0 || value === null || value <= 0) return null;
    return Math.log10(Math.max(value / base, 1e-6));
  });
  const known = logs.filter((value): value is number => value !== null);
  const lo = known.length ? Math.min(...known) : 0;
  const hi = known.length ? Math.max(...known) : 0;
  const span = hi - lo;
  const scaled = logs.map((value) => {
    if (value === null) return BOTTOM_W;
    if (span <= 0) return 1;
    return BOTTOM_W + (1 - BOTTOM_W) * ((value - lo) / span);
  });
  // Teto aplicado DEPOIS da escala: com log quase nunca morde, mas impede
  // duas etapas empatarem se o dado vier degenerado.
  return scaled.reduce<number[]>((acc, width, index) => {
    acc.push(index === 0 ? width : Math.min(width, acc[index - 1] * TAPER_MAX));
    return acc;
  }, []);
}

/** Altura total do SVG para N etapas. */
export function funnelChartHeight(stageCount: number): number {
  return stageCount * BAND_H + Math.max(0, stageCount - 1) * BAND_GAP;
}

/**
 * Quantas etapas de fato desenhar: a etapa de CAUDA sem dado (null ou 0) é
 * removida em vez de virar faixa tracejada — o funil não deve terminar num
 * degrau vazio (ex.: "Seguidores" antes da ingestão Meta existir). Nunca cai
 * abaixo de `min` (2); uma cauda vazia acima disso vira "—" normalmente.
 */
export function funnelStageCount(values: readonly (number | null)[], min = 2): number {
  let n = values.length;
  while (n > min && (values[n - 1] === null || values[n - 1] === 0)) n--;
  return n;
}

export type FunnelBand = {
  /** `d` do trapézio (encaixa na próxima etapa em vez de empilhar retângulos). */
  trapezoid: string;
  /** Etapa sem dado — faixa tracejada de largura mínima. */
  missing: boolean;
  /** `1 - index*0.12` para faixas com dado; `1` para as sem. */
  opacity: number;
  /** `d` da linha guia, da borda real da faixa até o rótulo. */
  leader: string;
  /** Ponto onde a linha guia encosta na faixa. */
  dot: { cx: number; cy: number };
  /** Âncora do rótulo (UPPERCASE), fora da forma. */
  labelAt: { x: number; y: number };
  /** Âncora do valor absoluto da etapa. */
  valueAt: { x: number; y: number };
  /** Âncora da taxa de conversão no vão abaixo; `null` na última etapa. */
  rateAt: { x: number; y: number } | null;
};

/**
 * Layout completo por faixa — os dois SVGs (tela e PDF) compartilham a
 * geometria inteira, não só as larguras. Espelha o corpo do `.map()` de
 * `FunnelChart`.
 */
export function funnelBandLayout(values: readonly (number | null)[]): FunnelBand[] {
  const widths = funnelBandWidths(values);
  return values.map((_, index) => {
    const y = index * (BAND_H + BAND_GAP);
    const top = widths[index] * FUNNEL_W;
    const bottom = (widths[index + 1] ?? widths[index] * 0.8) * FUNNEL_W;
    const x1 = (FUNNEL_W - top) / 2;
    const x2 = (FUNNEL_W - bottom) / 2;
    const midY = y + BAND_H / 2;
    const edge = Math.max(x1 + top, x2 + bottom);
    const missing = values[index] === null;
    return {
      trapezoid: `M${x1} ${y} H${x1 + top} L${x2 + bottom} ${y + BAND_H} H${x2} Z`,
      missing,
      opacity: missing ? 1 : 1 - index * 0.12,
      leader: `M${edge + 4} ${midY} H${LABEL_X - 6}`,
      dot: { cx: edge + 4, cy: midY },
      labelAt: { x: LABEL_X, y: midY - 4 },
      valueAt: { x: LABEL_X, y: midY + 15 },
      rateAt: index < values.length - 1 ? { x: FUNNEL_W / 2, y: y + BAND_H + 14 } : null,
    };
  });
}
