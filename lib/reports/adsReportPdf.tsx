// PDF do "Relatório de anúncios" (Automação 1 — relatorio_trafego_semanal).
//
// Reproduz a aba Aquisição da tela de Performance (AcquisitionDashboard.tsx)
// para o template escolhido — por padrão `builtin-funil-mensagens`. As seções
// são as mesmas de `ACQUISITION_SECTIONS`: KPIs / funil / evolução / volume /
// eficiência de mídia; depois, numa página própria, a tabela de campanhas.
//
// Renderiza server-side com @react-pdf/renderer (sem browser, sem rede) — Node
// runtime obrigatório (app/api/admin/automations/run/route.ts).
//
// Tudo vem de `config.acquisition` + `config.prefs.customMetrics`, exatamente
// como o dashboard (que faz `setKpiSlots(acq.kpiSlots)` etc.). `config.prefs`
// só entra para os defs de métrica custom e para `visibleColumns` (a tabela
// legada, que não tem equivalente em `acquisition`).
//
// Gráficos são SVG nativo do @react-pdf (Svg/Path/Circle/Polyline/LinearGradient).
// A geometria do funil mora em lib/reports/funnelGeometry.ts — a MESMA que
// desenha o funil da tela. Cores em lib/reports/reportTheme.ts (o renderer não
// vê CSS). Fontes em lib/reports/reportFonts.ts.

import {
  Circle, Defs, Document, G, LinearGradient, Line, Page, Path, Polyline,
  StyleSheet, Stop, Svg, Text, View, renderToBuffer,
} from "@react-pdf/renderer";
import {
  acquisitionDelta, acquisitionMetricLabel, acquisitionMetricSeries,
  acquisitionRateLabel, formatAcquisitionValue, ratio, resolveAcquisitionMetric,
  summarizeAcquisition, totalWhenPresent, type MetricKind, type NullableMetric,
} from "@/app/admin/performance/acquisitionInsights";
import {
  campaignMetricValue, campaignSummaries, isNotIntegrated, metricLabel,
  type Period,
} from "@/app/admin/performance/insights";
import { metricRefInverse, metricRefKind, metricValue } from "@/app/admin/performance/performanceLabels";
import type { PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import { CAMPAIGN_METRIC_COLUMNS, type MetricRef } from "@/lib/performancePrefs";
import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";
import { CHART_W, funnelBandLayout, funnelChartHeight } from "./funnelGeometry";
import { registerReportFonts } from "./reportFonts";
import { COMPASS_VIEWBOX, REPORT_COLORS as C, REPORT_SERIES, compassShapes } from "./reportTheme";
import type { CompassShape } from "@/app/brand/compass";
import type { ComponentProps, ReactNode } from "react";

registerReportFonts();

const S = StyleSheet.create({
  page: { padding: 30, fontFamily: "Inter", fontSize: 9, color: C.ink, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter", fontWeight: 700, fontSize: 15, color: C.ink },
  subtitle: { fontSize: 8.5, color: C.muted, marginTop: 2 },

  section: { marginBottom: 16 },
  kicker: { fontFamily: "Inter", fontWeight: 600, fontSize: 7.5, letterSpacing: 1, color: C.tealText, textTransform: "uppercase", marginBottom: 2 },
  sectionTitle: { fontFamily: "Inter", fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 8 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: { width: "31.8%", position: "relative", borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 9, backgroundColor: C.surface, minHeight: 58 },
  kpiCardGap: { borderStyle: "dashed", borderColor: C.borderStrong, backgroundColor: C.surface2 },
  kpiAccent: { position: "absolute", top: 0, right: 0, width: 34, height: 3, borderTopRightRadius: 8, backgroundColor: C.teal },
  kpiLabel: { fontFamily: "Inter", fontWeight: 600, fontSize: 6.8, letterSpacing: 0.6, color: C.sec, textTransform: "uppercase", marginBottom: 4 },
  kpiValue: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 15, color: C.ink },
  kpiValueGap: { color: C.muted },
  kpiHint: { fontSize: 6.8, color: C.muted, marginTop: 2 },
  delta: { fontSize: 7.5, fontWeight: 600, marginTop: 3 },
  deltaGood: { color: C.tealText },
  deltaBad: { color: C.danger },
  deltaNeutral: { color: C.muted },
  deltaGap: { color: C.goldText },

  funnelRow: { flexDirection: "row", gap: 16, alignItems: "center" },
  resultPanel: { flex: 1, borderWidth: 1, borderColor: C.tealSoft, borderRadius: 12, padding: 14, backgroundColor: C.tealSoft },
  resultLabel: { fontFamily: "Inter", fontWeight: 700, fontSize: 7, letterSpacing: 0.8, color: C.tealText, textTransform: "uppercase" },
  resultValue: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 28, color: C.ink, marginTop: 2 },
  resultRate: { fontSize: 8.5, color: C.sec, marginTop: 2 },
  resultSide: { flexDirection: "row", gap: 16, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.tealSoft },
  resultDt: { fontFamily: "Inter", fontWeight: 700, fontSize: 6.5, letterSpacing: 0.6, color: C.muted, textTransform: "uppercase" },
  resultDd: { fontSize: 12, fontWeight: 600, color: C.ink, marginTop: 2 },

  legendRow: { flexDirection: "row", gap: 14, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 8, color: C.sec },

  gaugeCard: { width: "31.8%", borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, backgroundColor: C.surface2, alignItems: "center" },
  gaugeLabel: { fontFamily: "Inter", fontWeight: 600, fontSize: 6.8, letterSpacing: 0.6, color: C.sec, textTransform: "uppercase", marginTop: 6 },
  gaugeValue: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 14, color: C.ink, marginTop: 2 },

  table: { borderWidth: 1, borderColor: C.border, borderRadius: 6 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  tableRowLast: { flexDirection: "row" },
  tableHeaderCell: { flex: 1, padding: 6, fontFamily: "Inter", fontWeight: 600, fontSize: 7.5, backgroundColor: C.surface2, color: C.sec },
  tableCell: { flex: 1, padding: 6, fontSize: 7.5, color: C.ink },
  tableCellFirst: { flex: 2.2 },

  empty: { fontSize: 8.5, color: C.muted, paddingVertical: 8 },
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, fontSize: 7, color: C.muted, textAlign: "center" },
});

export type AdsReportInput = {
  clientName: string;
  period: Period;
  cadenceLabel: string;
  config: PerformanceTemplateConfig;
  posts: MetaPost[];
  prevPosts: MetaPost[];
  generatedAt: Date;
};

// ---- pequenos utilitários -------------------------------------------------

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

/** kind do gauge — react-pdf não tem "number"; ratio vira decimal. */
function gaugeKind(kind: MetricKind): "money" | "percent" | "decimal" {
  return kind === "number" ? "decimal" : kind;
}

const COLUMN_LABEL = new Map(CAMPAIGN_METRIC_COLUMNS.map((c) => [c.key as string, c.label]));
function columnLabel(col: string, cm: Parameters<typeof metricRefKind>[1]): string {
  return COLUMN_LABEL.get(col) ?? acquisitionMetricLabel(col as MetricRef, cm, metricLabel);
}

// ---- componentes --------------------------------------------------------

// react-pdf lê fontFamily/fontWeight/fontSize direto das props de um <Text> SVG
// (@react-pdf/layout `resolveSvgText`) — os tipos publicados só omitem esses
// campos. Wrapper para não espalhar `as any` pelo arquivo.
type SvgTextProps = {
  x: number;
  y: number;
  fill: string;
  fontFamily: "Inter" | "Fraunces";
  fontWeight?: 400 | 600 | 700;
  fontSize: number;
  textAnchor?: "start" | "middle" | "end";
  children: ReactNode;
};
function SvgText(props: SvgTextProps) {
  return <Text {...(props as unknown as ComponentProps<typeof Text>)} />;
}

function CompassNode({ shape, ink }: { shape: CompassShape; ink: string }) {
  switch (shape.kind) {
    case "ring":
      return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} fill="none" stroke={ink} strokeWidth={shape.width} opacity={shape.opacity} />;
    case "dot":
      return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={ink} opacity={shape.opacity ?? 1} />;
    case "spoke":
      return <Line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={ink} strokeWidth={shape.width} opacity={shape.opacity} />;
    case "blade":
      return <Path d={shape.d} fill={ink} opacity={shape.opacity ?? 1} />;
  }
}

function DeltaText({ current, previous, inverse }: { current: NullableMetric; previous: NullableMetric; inverse: boolean }) {
  const value = acquisitionDelta(current, previous);
  if (value === null) return <Text style={[S.delta, S.deltaNeutral]}>Sem comparativo</Text>;
  const good = inverse ? value <= 0 : value >= 0;
  return (
    <Text style={[S.delta, good ? S.deltaGood : S.deltaBad]}>
      {value >= 0 ? "↑" : "↓"} {formatAcquisitionValue(Math.abs(value), "decimal")}% vs. anterior
    </Text>
  );
}

function KpiCard({
  label, value, previous, kind, inverse, notIntegrated = false, hint,
}: {
  label: string; value: NullableMetric; previous: NullableMetric;
  kind: MetricKind; inverse: boolean; notIntegrated?: boolean; hint?: string;
}) {
  return (
    <View style={notIntegrated ? [S.kpiCard, S.kpiCardGap] : S.kpiCard} wrap={false}>
      <View style={S.kpiAccent} />
      <Text style={S.kpiLabel}>{label.toUpperCase()}</Text>
      <Text style={notIntegrated ? [S.kpiValue, S.kpiValueGap] : S.kpiValue}>
        {notIntegrated ? "—" : formatAcquisitionValue(value, kind)}
      </Text>
      {notIntegrated
        ? <Text style={[S.delta, S.deltaGap]}>Sem integração</Text>
        : <DeltaText current={value} previous={previous} inverse={inverse} />}
      {hint ? <Text style={S.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

function FunnelSvg({ labels, values }: { labels: string[]; values: NullableMetric[] }) {
  const bands = funnelBandLayout(values);
  // rates[i] = taxa da transição da etapa i para a i+1 — mesmo indexado do
  // `stageRates` de FunnelChart (que faz `values.slice(1)`).
  const rates = values.slice(1).map((v, i) => acquisitionRateLabel(v, values[i]));
  const height = funnelChartHeight(labels.length);
  const width = 288;
  return (
    <Svg viewBox={`0 0 ${CHART_W} ${height}`} style={{ width, height: (width * height) / CHART_W }}>
      <Defs>
        <LinearGradient id="funnelBand" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={C.teal} />
          <Stop offset="100%" stopColor={C.tealText} />
        </LinearGradient>
      </Defs>
      {labels.map((label, i) => {
        const band = bands[i];
        return (
          <G key={label}>
            <Path
              d={band.trapezoid}
              fill={band.missing ? C.surface2 : "url(#funnelBand)"}
              stroke={band.missing ? C.borderStrong : undefined}
              strokeDasharray={band.missing ? "3 3" : undefined}
              opacity={band.opacity}
            />
            <Path d={band.leader} stroke={C.borderStrong} strokeWidth={0.75} fill="none" />
            <Circle cx={band.dot.cx} cy={band.dot.cy} r={2} fill={C.borderStrong} />
            <SvgText x={band.labelAt.x} y={band.labelAt.y} fill={C.sec} fontFamily="Inter" fontWeight={600} fontSize={7}>
              {label.toUpperCase()}
            </SvgText>
            <SvgText x={band.valueAt.x} y={band.valueAt.y} fill={C.ink} fontFamily="Fraunces" fontWeight={600} fontSize={14}>
              {formatAcquisitionValue(values[i])}
            </SvgText>
            {band.rateAt ? (
              <SvgText x={band.rateAt.x} y={band.rateAt.y} textAnchor="middle" fill={C.muted} fontFamily="Inter" fontWeight={600} fontSize={7}>
                {rates[i]}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

function ResultPanel({
  label, value, previousStage, previousLabel, spend,
}: {
  label: string; value: NullableMetric; previousStage: NullableMetric;
  previousLabel: string; spend: NullableMetric;
}) {
  const rate = ratio(value, previousStage, 100);
  return (
    <View style={S.resultPanel} wrap={false}>
      <Text style={S.resultLabel}>{label.toUpperCase()}</Text>
      <Text style={S.resultValue}>{formatAcquisitionValue(value)}</Text>
      {rate !== null && previousLabel ? (
        <Text style={S.resultRate}>
          {formatAcquisitionValue(rate, "percent")} de {previousLabel.toLowerCase()}
        </Text>
      ) : null}
      <View style={S.resultSide}>
        <View style={{ flex: 1 }}>
          <Text style={S.resultDt}>Custo por resultado</Text>
          <Text style={S.resultDd}>{formatAcquisitionValue(ratio(spend, value), "money")}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.resultDt}>Investimento</Text>
          <Text style={S.resultDd}>{formatAcquisitionValue(spend, "money")}</Text>
        </View>
      </View>
    </View>
  );
}

function TrendSvg({ series }: { series: { label: string; points: { date: string; value: number }[] }[] }) {
  const W = 520;
  const H = 150;
  const padL = 10;
  const padR = 10;
  const padT = 14;
  const padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series[0]?.points.length ?? 0;
  const x = (i: number) => padL + (i * innerW) / Math.max(1, n - 1);
  const first = series[0]?.points[0]?.date;
  const last = series[0]?.points.at(-1)?.date;
  const baseline = padT + innerH;
  // Cada série tem sua PRÓPRIA escala — "Linhas independentes · mesmo período",
  // como o TrendChart da tela (que usa dois eixos Y). Investimento (R$) e
  // Conversas (unidades) num eixo só deixaria a menor achatada no chão.
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: (531 * H) / W }}>
      <Line x1={padL} y1={baseline} x2={W - padR} y2={baseline} stroke={C.border} strokeWidth={1} />
      {series.map((s, si) => {
        const color = REPORT_SERIES[si % REPORT_SERIES.length];
        const seriesMax = Math.max(1, ...s.points.map((p) => p.value));
        const y = (v: number) => padT + (1 - v / seriesMax) * innerH;
        const maxLabel = (
          <SvgText key={`m${si}`} x={si === 0 ? padL : W - padR} y={padT - 4} textAnchor={si === 0 ? "start" : "end"} fill={color} fontFamily="Inter" fontWeight={600} fontSize={7}>
            {formatAcquisitionValue(seriesMax)}
          </SvgText>
        );
        if (n === 1) {
          return <G key={si}>{maxLabel}<Circle cx={x(0)} cy={y(s.points[0].value)} r={2.5} fill={color} /></G>;
        }
        const pts = s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
        return <G key={si}>{maxLabel}<Polyline points={pts} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" /></G>;
      })}
      {first ? <SvgText x={padL} y={H - 6} fill={C.muted} fontFamily="Inter" fontSize={7}>{shortDate(first)}</SvgText> : null}
      {last ? <SvgText x={W - padR} y={H - 6} textAnchor="end" fill={C.muted} fontFamily="Inter" fontSize={7}>{shortDate(last)}</SvgText> : null}
    </Svg>
  );
}

function GaugeCard({
  label, current, previous, kind, inverse,
}: {
  label: string; current: NullableMetric; previous: NullableMetric;
  kind: "money" | "percent" | "decimal"; inverse: boolean;
}) {
  const max = Math.max(current ?? 0, previous ?? 0);
  const progress = current === null || max === 0 ? 0 : Math.max(7, (current / max) * 100);
  const cx = 48;
  const cy = 44;
  const R = 34;
  const theta = ((180 - (progress / 100) * 180) * Math.PI) / 180;
  const px = cx + R * Math.cos(theta);
  const py = cy - R * Math.sin(theta);
  return (
    <View style={S.gaugeCard} wrap={false}>
      <Svg viewBox="0 0 96 56" style={{ width: 96, height: 56 }}>
        <Path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke={C.inset} strokeWidth={8} />
        {progress > 0 ? (
          <Path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${px} ${py}`} fill="none" stroke={C.tealStrong} strokeWidth={8} strokeLinecap="round" />
        ) : null}
      </Svg>
      <Text style={S.gaugeLabel}>{label.toUpperCase()}</Text>
      <Text style={S.gaugeValue}>{formatAcquisitionValue(current, kind)}</Text>
      <DeltaText current={current} previous={previous} inverse={inverse} />
    </View>
  );
}

// ---- documento ----------------------------------------------------------

function AdsReportDocument({ clientName, period, cadenceLabel, config, posts, prevPosts, generatedAt }: AdsReportInput) {
  const acq = config.acquisition;
  const cm = config.prefs.customMetrics;

  const summary = summarizeAcquisition(posts);
  const prevSummary = summarizeAcquisition(prevPosts);

  const kpi = (ref: MetricRef) => ({
    label: acquisitionMetricLabel(ref, cm, metricLabel),
    value: resolveAcquisitionMetric(posts, ref, cm),
    previous: resolveAcquisitionMetric(prevPosts, ref, cm),
    kind: metricRefKind(ref, cm),
    inverse: metricRefInverse(ref, cm),
    notIntegrated: isNotIntegrated(ref, cm),
  });

  const funnelValues = acq.funnelStages.map((r) => resolveAcquisitionMetric(posts, r, cm));
  const funnelLabels = acq.funnelStages.map((r) => acquisitionMetricLabel(r, cm, metricLabel));
  const spend = totalWhenPresent(posts, "custo");

  const trend = acq.trendMetrics.slice(0, 2).map((r) => ({
    label: acquisitionMetricLabel(r, cm, metricLabel),
    points: acquisitionMetricSeries(posts, r, period.from, period.to, cm).map((p) => ({ date: p.date, value: p.value ?? 0 })),
  }));

  const columns: (MetricRef | MetaPostMetricKey)[] = config.prefs.visibleColumns.length
    ? config.prefs.visibleColumns
    : ["alcance", "impressoes", "cliquesLink", "contatos", "custo"];
  const campaigns = campaignSummaries(posts)
    .sort((a, b) => (b.metrics.custo ?? b.metrics.alcance ?? 0) - (a.metrics.custo ?? a.metrics.alcance ?? 0))
    .slice(0, 14);

  const subtitle = `${cadenceLabel} · ${period.from} a ${period.to} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`;
  const Header = () => (
    <View style={S.header}>
      <Svg viewBox={`0 0 ${COMPASS_VIEWBOX} ${COMPASS_VIEWBOX}`} style={{ width: 22, height: 22 }}>
        {compassShapes.map((shape, i) => <CompassNode key={i} shape={shape} ink={C.tealStrong} />)}
      </Svg>
      <View>
        <Text style={S.title}>Funil de mensagens — {clientName}</Text>
        <Text style={S.subtitle}>{subtitle}</Text>
      </View>
    </View>
  );

  return (
    <Document>
      {/* Página 1 — KPIs + funil */}
      <Page size="A4" style={S.page}>
        <Header />

        <View style={S.section} wrap={false}>
          <Text style={S.kicker}>KPIs</Text>
          {acq.kpiSlots.length ? (
            <View style={S.grid}>
              {acq.kpiSlots.map((ref) => <KpiCard key={ref} {...kpi(ref)} />)}
            </View>
          ) : <Text style={S.empty}>Nenhum KPI configurado neste modelo.</Text>}
        </View>

        <View style={S.section} wrap={false}>
          <Text style={S.kicker}>Conversão e intenção</Text>
          <Text style={S.sectionTitle}>Funil de aquisição</Text>
          <View style={S.funnelRow}>
            <FunnelSvg labels={funnelLabels} values={funnelValues} />
            <ResultPanel
              label={funnelLabels.at(-1) ?? "Resultado"}
              value={funnelValues.at(-1) ?? null}
              previousStage={funnelValues.at(-2) ?? null}
              previousLabel={funnelLabels.at(-2) ?? ""}
              spend={spend}
            />
          </View>
        </View>

        <Text style={S.footer} fixed>North — relatório gerado automaticamente</Text>
      </Page>

      {/* Página 2 — evolução + volume + eficiência de mídia */}
      <Page size="A4" style={S.page}>
        <Header />

        <View style={S.section} wrap={false}>
          <Text style={S.kicker}>Evolução</Text>
          <Text style={S.sectionTitle}>{trend.map((t) => t.label).join(" x ") || "Tendência"}</Text>
          {trend.length && trend[0].points.length ? (
            <>
              <TrendSvg series={trend} />
              <View style={S.legendRow}>
                {trend.map((t, i) => (
                  <View style={S.legendItem} key={i}>
                    <View style={[S.legendDot, { backgroundColor: REPORT_SERIES[i % REPORT_SERIES.length] }]} />
                    <Text style={S.legendLabel}>{t.label}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : <Text style={S.empty}>Sem série no período.</Text>}
        </View>

        <View style={S.section} wrap={false}>
          <Text style={S.kicker}>Volume</Text>
          <View style={S.grid}>
            {acq.volumeSlots.map((ref) => <KpiCard key={ref} {...kpi(ref)} />)}
            <KpiCard
              label="Taxa de conversão"
              value={summary.conversionRate}
              previous={prevSummary.conversionRate}
              kind="percent"
              inverse={false}
              hint="Leads ÷ cliques"
            />
          </View>
        </View>

        <View style={S.section} wrap={false}>
          <Text style={S.kicker}>Eficiência de mídia</Text>
          <Text style={S.sectionTitle}>Custos e taxas</Text>
          {acq.gaugeSlots.length ? (
            <View style={S.grid}>
              {acq.gaugeSlots.map((ref) => (
                <GaugeCard
                  key={ref}
                  label={acquisitionMetricLabel(ref, cm, metricLabel)}
                  current={resolveAcquisitionMetric(posts, ref, cm)}
                  previous={resolveAcquisitionMetric(prevPosts, ref, cm)}
                  kind={gaugeKind(metricRefKind(ref, cm))}
                  inverse={metricRefInverse(ref, cm)}
                />
              ))}
            </View>
          ) : <Text style={S.empty}>Nenhum indicador de eficiência configurado.</Text>}
        </View>

        <Text style={S.footer} fixed>North — relatório gerado automaticamente</Text>
      </Page>

      {/* Página 3 — tabela de campanhas */}
      <Page size="A4" style={S.page} wrap>
        <Header />
        <Text style={S.sectionTitle}>Campanhas</Text>
        {campaigns.length ? (
          <View style={S.table}>
            <View style={S.tableRow}>
              <Text style={[S.tableHeaderCell, S.tableCellFirst]}>Campanha</Text>
              {columns.map((col) => (
                <Text style={S.tableHeaderCell} key={col}>{columnLabel(String(col), cm)}</Text>
              ))}
            </View>
            {campaigns.map((row, i) => (
              <View style={i === campaigns.length - 1 ? S.tableRowLast : S.tableRow} key={row.key} wrap={false}>
                <Text style={[S.tableCell, S.tableCellFirst]}>{row.caption || "Sem nome"}</Text>
                {columns.map((col) => {
                  const isBuiltin = !String(col).startsWith("custom:");
                  const raw = isBuiltin ? row.metrics[col as MetaPostMetricKey] : campaignMetricValue(row, col as MetricRef, cm);
                  return (
                    <Text style={S.tableCell} key={col}>
                      {raw === undefined ? "—" : metricValue(raw, metricRefKind(col as MetricRef, cm), row.currency)}
                    </Text>
                  );
                })}
              </View>
            ))}
          </View>
        ) : <Text style={S.empty}>Nenhuma campanha com dados no período.</Text>}

        <Text style={S.footer} fixed>North — relatório gerado automaticamente</Text>
      </Page>
    </Document>
  );
}

export async function renderAdsReportPdf(input: AdsReportInput): Promise<Buffer> {
  return renderToBuffer(<AdsReportDocument {...input} />);
}
