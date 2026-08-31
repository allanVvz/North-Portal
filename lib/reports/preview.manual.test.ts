// Preview MANUAL do relatório de anúncios contra dados REAIS do Meta.
//
// Inerte no CI (roda só com PREVIEW_CLIENT setado). Uso:
//   PREVIEW_CLIENT=cris-car-care PREVIEW_DAYS=14 npx vitest run lib/reports/preview.manual.test.ts
// Escreve scratchpad/preview-ads-<slug>.pdf. Lê credenciais de .env.local.

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

describe.skipIf(!SLUG)("preview relatório de anúncios (dados reais)", () => {
  it(`renderiza ${SLUG} (${DAYS}d) para scratchpad/`, async () => {
    loadEnvLocal();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { getWindsorSettingsService, getMetaSettingsService, adsAccountFor } = await import("@/lib/automations/serviceIntegrations");
    const { fetchPostsForAccount } = await import("@/lib/automations/run");
    const { renderAdsReportPdf } = await import("./adsReportPdf");
    const { DEFAULT_BUILTIN_TEMPLATE } = await import("@/lib/performanceTemplates");
    const { inPeriod, previousPeriod } = await import("@/app/admin/performance/insights");

    const admin = createAdminClient();
    const { data } = await admin.from("clients").select("id,slug,name").eq("slug", SLUG!).limit(1);
    const client = data?.[0] as { id: string; slug: string; name: string } | undefined;
    expect(client, `cliente ${SLUG} não encontrado`).toBeTruthy();

    const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
    const account = adsAccountFor(client!.slug, windsor, meta);
    expect(account, `sem conta de anúncios para ${SLUG}`).toBeTruthy();

    const to = new Date();
    const from = new Date(to.getTime() - (DAYS - 1) * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const period = { from: iso(from), to: iso(to) };
    const prev = previousPeriod(period);

    const { campaignPosts, adPosts } = await fetchPostsForAccount(account!, windsor, meta, prev.from, period.to);
    const buf = await renderAdsReportPdf({
      clientName: client!.name,
      period,
      cadenceLabel: `${DAYS} dias`,
      config: DEFAULT_BUILTIN_TEMPLATE.config,
      posts: campaignPosts.filter((p) => inPeriod(p, period)),
      prevPosts: campaignPosts.filter((p) => inPeriod(p, prev)),
      adPosts: adPosts.filter((p) => inPeriod(p, period)),
      generatedAt: new Date(),
    });

    const out = process.env.PREVIEW_OUT ?? resolve(process.cwd(), `preview-ads-${SLUG}.pdf`);
    writeFileSync(out, buf);
    console.log("campanhas:", campaignPosts.length, "· criativos:", adPosts.length, "· PDF:", out, buf.byteLength, "bytes");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 120_000);
});
