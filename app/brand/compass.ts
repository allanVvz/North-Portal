// ============================================================================
// FONTE ÚNICA DA MARCA NORTH — a bússola.
//
// Este arquivo é o ÚNICO lugar onde a geometria do símbolo existe. Tudo o que
// desenha a marca lê daqui:
//
//   app/brand/CompassMark.tsx     -> o símbolo em React (site, admin, login)
//   scripts/generate-brand-icons.mjs -> gera app/icon.svg e app/apple-icon.svg
//   lib/brand.test.ts             -> falha o `npm run verify` se os SVGs
//                                    gerados saírem do passo com este arquivo
//
// Para trocar o desenho da marca: edite SÓ este arquivo e rode
// `npm run brand:icons`. Nunca edite app/icon.svg à mão — ele é gerado.
// ============================================================================

/** Lado do quadrado de desenho. Todo o resto é em coordenadas deste espaço. */
export const COMPASS_VIEWBOX = 32;

/**
 * Uma forma do símbolo. A marca é monocromática de propósito: nenhuma forma
 * carrega cor própria — só `opacity`. Quem renderiza escolhe a tinta (uma só),
 * e é dela que vem toda a profundidade. Isso é o que faz a mesma bússola
 * funcionar em creme sobre petróleo (admin, favicon) e em sage sobre papel
 * (site claro) sem virar dois desenhos diferentes.
 */
export type CompassShape =
  | { kind: "ring"; cx: number; cy: number; r: number; width: number; opacity: number }
  | { kind: "dot"; cx: number; cy: number; r: number; opacity?: number }
  | { kind: "spoke"; x1: number; y1: number; x2: number; y2: number; width: number; opacity: number }
  | { kind: "blade"; d: string; opacity?: number };

const C = COMPASS_VIEWBOX / 2; // centro: 16
const R_OUTER = 13.8; // aro externo
const R_INNER = 10.6; // aro interno (bisel)
const R_TICK = 0.95; // marca cardeal
const TICK_POS = 2.2; // distância da borda até a marca cardeal

/**
 * A rosa dos ventos, do fundo para a frente. A ordem importa: as agulhas
 * cobrem os aros, e a joia central cobre as agulhas.
 */
export const compassShapes: readonly CompassShape[] = [
  // aros finos, bisel duplo
  { kind: "ring", cx: C, cy: C, r: R_OUTER, width: 0.6, opacity: 0.38 },
  { kind: "ring", cx: C, cy: C, r: R_INNER, width: 0.4, opacity: 0.2 },

  // raios intercardeais (NE, SE, SO, NO) — detalhe delicado no bisel
  { kind: "spoke", x1: 24.63, y1: 7.37, x2: 25.76, y2: 6.24, width: 0.7, opacity: 0.3 },
  { kind: "spoke", x1: 24.63, y1: 24.63, x2: 25.76, y2: 25.76, width: 0.7, opacity: 0.3 },
  { kind: "spoke", x1: 7.37, y1: 24.63, x2: 6.24, y2: 25.76, width: 0.7, opacity: 0.3 },
  { kind: "spoke", x1: 7.37, y1: 7.37, x2: 6.24, y2: 6.24, width: 0.7, opacity: 0.3 },

  // marcas cardeais (N, L, S, O), assentadas sobre o aro
  { kind: "dot", cx: C, cy: TICK_POS, r: R_TICK, opacity: 0.6 },
  { kind: "dot", cx: COMPASS_VIEWBOX - TICK_POS, cy: C, r: R_TICK, opacity: 0.6 },
  { kind: "dot", cx: C, cy: COMPASS_VIEWBOX - TICK_POS, r: R_TICK, opacity: 0.6 },
  { kind: "dot", cx: TICK_POS, cy: C, r: R_TICK, opacity: 0.6 },

  // agulha Leste-Oeste: esguia, ao fundo, partida ao meio (face clara/escura)
  { kind: "blade", d: "M2 16 L16 15.1 L30 16 Z", opacity: 0.26 },
  { kind: "blade", d: "M2 16 L16 16.9 L30 16 Z", opacity: 0.42 },

  // agulha Norte-Sul: mais longa e afiada, em primeiro plano — é ela que
  // aponta, e é a única forma em opacidade cheia
  { kind: "blade", d: "M16 2 L14.7 16 L16 30 Z", opacity: 0.72 },
  { kind: "blade", d: "M16 2 L17.3 16 L16 30 Z" },

  // joia central
  { kind: "ring", cx: C, cy: C, r: 2.3, width: 0.4, opacity: 0.5 },
  { kind: "dot", cx: C, cy: C, r: 1.1 },
];

/** Formata número sem zeros à toa (16.0 -> "16"), para o SVG sair limpo. */
function n(value: number): string {
  return String(Number(value.toFixed(3)));
}

function attr(name: string, value: number | string | undefined): string {
  return value === undefined ? "" : ` ${name}="${value}"`;
}

/**
 * Uma forma como markup SVG, com a tinta já resolvida.
 * Usado pelo gerador de ícones (arquivo estático, cor fixa).
 */
function shapeToSvg(shape: CompassShape, ink: string): string {
  const o = (opacity?: number) => attr("opacity", opacity === undefined ? undefined : n(opacity));
  switch (shape.kind) {
    case "ring":
      return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}" fill="none" stroke="${ink}" stroke-width="${n(shape.width)}"${o(shape.opacity)}/>`;
    case "dot":
      return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}" fill="${ink}"${o(shape.opacity)}/>`;
    case "spoke":
      return `<line x1="${n(shape.x1)}" y1="${n(shape.y1)}" x2="${n(shape.x2)}" y2="${n(shape.y2)}" stroke="${ink}" stroke-width="${n(shape.width)}"${o(shape.opacity)}/>`;
    case "blade":
      return `<path d="${shape.d}" fill="${ink}"${o(shape.opacity)}/>`;
  }
}

export type CompassIconOptions = {
  /** Cor do desenho. */
  ink: string;
  /** Cor do fundo. Omita para fundo transparente (sem placa). */
  background?: string;
  /** Raio do canto da placa de fundo. Ignorado sem `background`. */
  radius?: number;
  /** Tamanho declarado no SVG. O desenho é vetorial e escala sozinho. */
  size?: number;
};

/**
 * O símbolo como arquivo SVG completo — é isto que vira o favicon.
 * Determinístico: mesma entrada, mesmo byte de saída (o teste de drift depende
 * disso).
 */
export function compassSvgMarkup({ ink, background, radius = 8, size = 32 }: CompassIconOptions): string {
  const v = COMPASS_VIEWBOX;
  const plate = background
    ? `\n  <rect width="${v}" height="${v}" rx="${n(radius)}" fill="${background}"/>`
    : "";
  const body = compassShapes.map((s) => `\n  ${shapeToSvg(s, ink)}`).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${v} ${v}" fill="none" xmlns="http://www.w3.org/2000/svg">${plate}${body}\n</svg>\n`;
}
