import path from "node:path";
import { Font } from "@react-pdf/renderer";

// O @react-pdf/renderer não tem CSS nem @font-face — só carrega arquivos de
// fonte locais. Estes são os mesmos rostos da tela de Performance: Inter no
// corpo, Fraunces (corte óptico 72pt) nos números grandes. Ver
// lib/reports/fonts/LICENSE.md.
//
// `process.cwd()` é a raiz do projeto localmente e dentro da função da Vercel.
// Os .ttf entram no bundle da rota via `outputFileTracingIncludes` em
// next.config.ts (o tracer não enxerga um path.join dinâmico sozinho).

const FONT_DIR = path.join(process.cwd(), "lib", "reports", "fonts");

let registered = false;

/** Idempotente — chamada no escopo de módulo por adsReportPdf.tsx. */
export function registerReportFonts(): void {
  if (registered) return;
  registered = true;

  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(FONT_DIR, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Inter-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "Inter-Bold.ttf"), fontWeight: 700 },
    ],
  });

  Font.register({
    family: "Fraunces",
    fonts: [
      { src: path.join(FONT_DIR, "Fraunces72pt-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Fraunces72pt-SemiBold.ttf"), fontWeight: 600 },
    ],
  });

  // Relatório não quebra palavra: uma quebra no meio de "Investimento" num
  // rótulo de KPI fica pior que o texto transbordar um pouco.
  Font.registerHyphenationCallback((word) => [word]);
}
