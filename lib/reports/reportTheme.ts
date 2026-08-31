import { COMPASS_VIEWBOX, compassShapes } from "@/app/brand/compass";

// Paleta "Névoa Sage" (tema claro) para o PDF da automação. O
// @react-pdf/renderer não vê CSS — nenhum `var(--a-*)` resolve —, então os hex
// vivem aqui, literais.
//
// DEVE FICAR EM SYNC com:
//   - app/globals.css  `.admin-shell` (tema claro, ~linha 1673)
//   - app/admin/performance/charts/chartTheme.ts  `FALLBACK` / `DARK_SERIES`
//   - app/brand/tokens.ts  `BRAND_COLORS`
// (mesma duplicação consciente que já existe entre esses três — "lugares que
// não enxergam o CSS").

export const REPORT_COLORS = {
  bg: "#eef1ed",
  surface: "#fbfcfa",
  surface2: "#e7eae5",
  inset: "#e4e8e2",
  border: "#dee3dd",
  borderStrong: "#c2cac2",
  ink: "#0c2c2c",
  sec: "#46584f",
  muted: "#5c6b62",
  teal: "#5e9c93",
  tealStrong: "#4a857c",
  tealText: "#336e64",
  tealSoft: "#dceae4",
  cream: "#e8dcc0",
  danger: "#c2604e",
  goldText: "#8a6d2f",
  blueText: "#3c6285",
  purpleText: "#6a5a82",
} as const;

/** teal, blue, gold, purple — POSICIONAL (fatia N → cor N), nunca ciclado.
 *  Mesma ordem de `chartTheme.ts` `FALLBACK.series`. */
export const REPORT_SERIES = ["#4a857c", "#3c6285", "#8a6d2f", "#6a5a82"] as const;

export const REPORT_FONT = { display: "Fraunces", body: "Inter" } as const;

// A bússola da marca como dados de forma (não string SVG — o react-pdf precisa
// de nós, não de markup). `compassSvgMarkup()` de app/brand/compass.ts devolve
// string e não serve aqui.
export { COMPASS_VIEWBOX, compassShapes };
