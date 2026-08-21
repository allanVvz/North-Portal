// Weekly ads report PDF (Automação 1 — relatorio_trafego_semanal). Layout is
// driven entirely by the chosen PerformanceTemplateConfig
// (kpiSlots/visibleColumns) — editing the template in Configurações changes
// the PDF's content without touching this renderer. Renders server-side with
// @react-pdf/renderer (no headless browser) — Node runtime required
// (app/api/admin/automations/run/route.ts sets runtime = "nodejs").

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";
import { campaignSummaries, fmtCompact, kpiSummaryFromSlots, metricRefLabel } from "@/app/admin/performance/insights";
import type { PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import type { Period } from "@/app/admin/performance/insights";
import type { MetricRef } from "@/lib/performancePrefs";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { marginBottom: 18 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#555555" },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#111111" },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: { width: "31%", borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 4, padding: 8, marginBottom: 8 },
  kpiLabel: { fontSize: 8, color: "#666666", marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: 700 },
  kpiDelta: { fontSize: 8, marginTop: 2 },
  table: { borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e5e5" },
  tableRowLast: { flexDirection: "row" },
  tableHeaderCell: { flex: 1, padding: 6, fontSize: 8, fontWeight: 700, backgroundColor: "#f5f5f5", color: "#333333" },
  tableCell: { flex: 1, padding: 6, fontSize: 8 },
  tableCellFirst: { flex: 2 },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, fontSize: 8, color: "#999999", textAlign: "center" },
  empty: { fontSize: 9, color: "#666666", fontStyle: "italic" },
});

function fmtMetricValue(key: MetaPostMetricKey | string, value: number): string {
  if (key === "custo") return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (key === "ctr") return `${value.toFixed(2)}%`;
  if (key === "cpc" || key === "cpm") return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return fmtCompact(value);
}

export type AdsReportInput = {
  clientName: string;
  period: Period;
  cadenceLabel: string;
  config: PerformanceTemplateConfig;
  posts: MetaPost[];
  prevPosts: MetaPost[];
  generatedAt: Date;
};

function AdsReportDocument({ clientName, period, cadenceLabel, config, posts, prevPosts, generatedAt }: AdsReportInput) {
  const kpis = kpiSummaryFromSlots(posts, prevPosts, config.prefs.kpiSlots, config.prefs.customMetrics);
  const campaigns = campaignSummaries(posts).sort(
    (a, b) => (b.metrics.custo ?? b.metrics.alcance ?? 0) - (a.metrics.custo ?? a.metrics.alcance ?? 0),
  );
  const columns = config.prefs.visibleColumns.length ? config.prefs.visibleColumns : ["alcance", "impressoes", "custo"];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Relatório de anúncios — {clientName}</Text>
          <Text style={styles.subtitle}>
            {cadenceLabel} · {period.from} a {period.to} · gerado em {generatedAt.toLocaleDateString("pt-BR")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resumo</Text>
          <View style={styles.kpiRow}>
            {kpis.length ? kpis.map((kpi) => (
              <View style={styles.kpiCard} key={kpi.metric}>
                <Text style={styles.kpiLabel}>{kpi.label}</Text>
                <Text style={styles.kpiValue}>{kpi.available ? fmtMetricValue(kpi.metric, kpi.value) : "—"}</Text>
                {kpi.delta !== null ? (
                  // Base-14 Helvetica (no custom font registered) has no ▲/▼
                  // glyphs — they render as garbage in the PDF. Plain ASCII.
                  <Text style={styles.kpiDelta}>{kpi.delta >= 0 ? "+" : "-"}{Math.abs(kpi.delta)}% vs. período anterior</Text>
                ) : null}
              </View>
            )) : <Text style={styles.empty}>Nenhum indicador configurado neste modelo.</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Campanhas</Text>
          {campaigns.length ? (
            <View style={styles.table}>
              <View style={styles.tableRow}>
                <Text style={[styles.tableHeaderCell, styles.tableCellFirst]}>Campanha</Text>
                {columns.map((col) => (
                  <Text style={styles.tableHeaderCell} key={col}>{metricRefLabel(col as MetricRef, config.prefs.customMetrics)}</Text>
                ))}
              </View>
              {campaigns.map((row, i) => (
                <View style={i === campaigns.length - 1 ? styles.tableRowLast : styles.tableRow} key={row.key}>
                  <Text style={[styles.tableCell, styles.tableCellFirst]}>{row.caption || "Sem nome"}</Text>
                  {columns.map((col) => (
                    <Text style={styles.tableCell} key={col}>
                      {row.metrics[col as MetaPostMetricKey] !== undefined ? fmtMetricValue(col, row.metrics[col as MetaPostMetricKey] as number) : "—"}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : <Text style={styles.empty}>Nenhuma campanha com dados no período.</Text>}
        </View>

        <Text style={styles.footer} fixed>North — relatório gerado automaticamente</Text>
      </Page>
    </Document>
  );
}

export async function renderAdsReportPdf(input: AdsReportInput): Promise<Buffer> {
  return renderToBuffer(<AdsReportDocument {...input} />);
}
