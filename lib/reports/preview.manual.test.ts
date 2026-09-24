// Preview MANUAL do relatório de anúncios contra dados REAIS do Meta.
//
// É a ferramenta de FEEDBACK do layout: renderiza o PDF só no disco local, sem
// escrever nada em produção — nenhum documento, nenhum comentário, nenhuma
// revisão. Qualquer mudança de diagramação se confere aqui ANTES de regerar os
// relatórios de verdade; regerar em produção só para olhar o resultado é o que
// enche os cards de PDF duplicado.
//
// Inerte no CI (roda só com PREVIEW_CLIENT setado). Uso:
//   PREVIEW_CLIENT=cris-car-care PREVIEW_DAYS=14 npx vitest run lib/reports/preview.manual.test.ts
//
// Para reproduzir uma semana específica — a mesma que o relatório real cobriu —
// em vez da janela que termina hoje:
//   PREVIEW_CLIENT=falke-estetica PREVIEW_FROM=2026-09-15 PREVIEW_TO=2026-09-21 npx vitest run lib/reports/preview.manual.test.ts
//
// Para o relatório de CONVERSÃO (o que vai ao cliente), com o molde do cliente e
// os números que o feedback informou:
//   PREVIEW_CLIENT=cris-car-care PREVIEW_REPORT=conversao PREVIEW_TEMPLATE=builtin-ecommerce \
//     PREVIEW_FROM=2026-09-15 PREVIEW_TO=2026-09-21 PREVIEW_SEGUIDORES_NOVOS=21 \
//     npx vitest run lib/reports/preview.manual.test.ts
//
// Para ver o PDF depois (poppler instalado via winget oschwartz10612.Poppler):
//   pdftoppm -png -r 80 preview-ads-<slug>.pdf pagina
//
// Escreve preview-ads-<slug>.pdf na raiz (ou PREVIEW_OUT). Lê credenciais de .env.local.

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, "");
    }
  } catch { /* .env.local ausente — o teste é skip mesmo */ }
}

const SLUG = process.env.PREVIEW_CLIENT;
const DAYS = Number(process.env.PREVIEW_DAYS ?? 14);
// Semanas de histórico que alimentam "Últimas N semanas". Sem isto o preview não
// renderizava a seção de tendência e justamente ela é onde a quebra de página
// aparece (título órfão no pé de uma página, gráfico na seguinte).
const TREND_WEEKS = 6;
// "anuncios" (padrão, interno) ou "conversao" (o que vai ao cliente).
const REPORT = process.env.PREVIEW_REPORT === "conversao" ? "conversao" : "anuncios";

describe.skipIf(!SLUG)(`preview relatório de ${REPORT} (dados reais)`, () => {
  it(`renderiza ${SLUG} para o disco local`, async () => {
    loadEnvLocal();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { getWindsorSettingsService, getMetaSettingsService, adsAccountFor } = await import("@/lib/automations/serviceIntegrations");
    const { fetchPostsForAccount } = await import("@/lib/automations/reportData");
    const { renderAdsReportPdf } = await import("./adsReportPdf");
    const { renderSalesReportPdf } = await import("./salesReportPdf");
    const { DEFAULT_BUILTIN_TEMPLATE, BUILTIN_PERFORMANCE_TEMPLATES } = await import("@/lib/performanceTemplates");
    const { inPeriod, previousPeriod } = await import("@/app/admin/performance/insights");

    const admin = createAdminClient();
    const { data } = await admin.from("clients").select("id,slug,name").eq("slug", SLUG!).limit(1);
    const client = data?.[0] as { id: string; slug: string; name: string } | undefined;
    expect(client, `cliente ${SLUG} não encontrado`).toBeTruthy();

    const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
    const account = adsAccountFor(client!.slug, windsor, meta);
    expect(account, `sem conta de anúncios para ${SLUG}`).toBeTruthy();

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const to = new Date();
    const period = process.env.PREVIEW_FROM && process.env.PREVIEW_TO
      ? { from: process.env.PREVIEW_FROM, to: process.env.PREVIEW_TO }
      : { from: iso(new Date(to.getTime() - (DAYS - 1) * 86400000)), to: iso(to) };
    const prev = previousPeriod(period);

    // A janela buscada cobre o histórico da tendência, não só as duas semanas
    // comparadas — mesma regra de `fillReportCard`.
    const trendFrom = iso(new Date(new Date(`${period.from}T00:00:00Z`).getTime() - (TREND_WEEKS - 1) * 7 * 86400000));
    const { campaignPosts, adPosts } = await fetchPostsForAccount(account!, windsor, meta, trendFrom < prev.from ? trendFrom : prev.from, period.to);
    // O molde muda a diagramação do relatório de conversão (quais KPIs cada
    // bloco declara), então conferir layout com o molde errado não vale nada.
    const template = process.env.PREVIEW_TEMPLATE
      ? BUILTIN_PERFORMANCE_TEMPLATES.find((t) => t.id === process.env.PREVIEW_TEMPLATE)
      : DEFAULT_BUILTIN_TEMPLATE;
    expect(template, `molde ${process.env.PREVIEW_TEMPLATE} não existe`).toBeTruthy();

    const doPeriodo = campaignPosts.filter((p) => inPeriod(p, period));
    const doAnterior = campaignPosts.filter((p) => inPeriod(p, prev));
    const adsDoPeriodo = adPosts.filter((p) => inPeriod(p, period));
    const adsDoAnterior = adPosts.filter((p) => inPeriod(p, prev));
    const numeroOuNull = (v: string | undefined) => (v === undefined ? null : Number(v));

    const buf = REPORT === "conversao"
      ? await renderSalesReportPdf({
          clientName: client!.name,
          period,
          cadenceLabel: process.env.PREVIEW_FROM ? "semanal" : `${DAYS} dias`,
          config: template!.config,
          campaignPosts: doPeriodo,
          adPosts: adsDoPeriodo,
          prevCampaignPosts: doAnterior,
          prevAdPosts: adsDoAnterior,
          conversoes: [],
          // O que o feedback informaria. Sem isto o funil sai sem a etapa de
          // seguidores e a página 1 não reproduz a altura real.
          seguidoresNovos: numeroOuNull(process.env.PREVIEW_SEGUIDORES_NOVOS),
          seguidores: numeroOuNull(process.env.PREVIEW_SEGUIDORES),
          vendasTotal: numeroOuNull(process.env.PREVIEW_VENDAS),
          generatedAt: new Date(),
        })
      : await renderAdsReportPdf({
          clientName: client!.name,
          period,
          cadenceLabel: process.env.PREVIEW_FROM ? "semanal" : `${DAYS} dias`,
          config: template!.config,
          posts: doPeriodo,
          prevPosts: doAnterior,
          adPosts: adsDoPeriodo,
          prevAdPosts: adsDoAnterior,
          trendPosts: campaignPosts,
          generatedAt: new Date(),
        });

    const out = process.env.PREVIEW_OUT ?? resolve(process.cwd(), `preview-${REPORT}-${SLUG}.pdf`);
    writeFileSync(out, buf);
    console.log("campanhas:", campaignPosts.length, "· criativos:", adPosts.length, "· PDF:", out, buf.byteLength, "bytes");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 120_000);
});
