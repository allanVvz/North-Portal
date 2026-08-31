// Componentes e estilos compartilhados pelos PDFs de relatório
// (lib/reports/adsReportPdf.tsx e lib/reports/salesReportPdf.tsx).
//
// Extraído de adsReportPdf.tsx sem mudança de comportamento: os dois relatórios
// desenham os mesmos KPIs, o mesmo funil (geometria em funnelGeometry.ts) e o
// mesmo painel de resultado, com a paleta Névoa Sage (reportTheme.ts) e as
// fontes vendorizadas (reportFonts.ts). react-pdf não vê CSS — todo estilo é
// objeto literal aqui.

import { Circle, Defs, G, LinearGradient, Line, Path, StyleSheet, Stop, Svg, Text, View } from "@react-pdf/renderer";
import {
  acquisitionDelta, acquisitionRateLabel, formatAcquisitionValue,
  ratio, type MetricKind, type NullableMetric,
} from "@/app/admin/performance/acquisitionInsights";
import { CHART_W, funnelBandLayout, funnelChartHeight } from "./funnelGeometry";
import { REPORT_COLORS as C } from "./reportTheme";
import type { CompassShape } from "@/app/brand/compass";
import type { ComponentProps, ReactNode } from "react";

// Layout COMPACTO. As seções que o operador esconde no template não são
// renderizadas, então a folha respira conforme ele apara.
export const REPORT_STYLES = StyleSheet.create({
  page: { paddingVertical: 16, paddingHorizontal: 20, fontFamily: "Inter", fontSize: 7.5, color: C.ink, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 7, paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter", fontWeight: 700, fontSize: 11.5, color: C.ink },
  subtitle: { fontSize: 7, color: C.muted, marginTop: 1 },

  section: { marginBottom: 6 },
  kicker: { fontFamily: "Inter", fontWeight: 600, fontSize: 6.6, letterSpacing: 0.9, color: C.tealText, textTransform: "uppercase", marginBottom: 2 },
  sectionTitle: { fontFamily: "Inter", fontWeight: 700, fontSize: 9, color: C.ink, marginBottom: 3 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  kpiCard: { width: "32%", position: "relative", borderWidth: 1, borderColor: C.border, borderRadius: 5, paddingVertical: 4, paddingHorizontal: 6, backgroundColor: C.surface },
  kpiCardGap: { borderStyle: "dashed", borderColor: C.borderStrong, backgroundColor: C.surface2 },
  kpiAccent: { position: "absolute", top: 0, right: 0, width: 24, height: 2.5, borderTopRightRadius: 5, backgroundColor: C.teal },
  kpiLabel: { fontFamily: "Inter", fontWeight: 600, fontSize: 5.8, letterSpacing: 0.4, color: C.sec, textTransform: "uppercase", marginBottom: 2 },
  kpiValue: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 11.5, color: C.ink },
  kpiValueGap: { color: C.muted },
  kpiHint: { fontSize: 5.8, color: C.muted, marginTop: 1 },
  delta: { fontSize: 6.2, fontWeight: 600, marginTop: 1.5 },
  deltaGood: { color: C.tealText },
  deltaBad: { color: C.danger },
  deltaNeutral: { color: C.muted },
  deltaGap: { color: C.goldText },

  funnelRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  resultPanel: { flex: 1, borderWidth: 1, borderColor: C.tealSoft, borderRadius: 9, padding: 9, backgroundColor: C.tealSoft },
  resultLabel: { fontFamily: "Inter", fontWeight: 700, fontSize: 6.3, letterSpacing: 0.6, color: C.tealText, textTransform: "uppercase" },
  resultValue: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 19, color: C.ink, marginTop: 1 },
  resultRate: { fontSize: 7.5, color: C.sec, marginTop: 1 },
  resultSide: { flexDirection: "row", gap: 12, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.tealSoft },
  resultDt: { fontFamily: "Inter", fontWeight: 700, fontSize: 5.8, letterSpacing: 0.4, color: C.muted, textTransform: "uppercase" },
  resultDd: { fontSize: 9.5, fontWeight: 600, color: C.ink, marginTop: 1 },

  legendRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLabel: { fontSize: 7.5, color: C.sec },

  gaugeCard: { width: "32%", borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 7, backgroundColor: C.surface2, alignItems: "center" },
  gaugeLabel: { fontFamily: "Inter", fontWeight: 600, fontSize: 5.8, letterSpacing: 0.4, color: C.sec, textTransform: "uppercase", marginTop: 3 },
  gaugeValue: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 11, color: C.ink, marginTop: 1 },

  blockGroup: { marginBottom: 5 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  blockTitle: { fontFamily: "Inter", fontWeight: 700, fontSize: 8.5, color: C.ink },
  campaignHead: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, marginBottom: 2 },
  campaignName: { fontFamily: "Inter", fontWeight: 600, fontSize: 7, color: C.sec },
  chip: { fontFamily: "Inter", fontWeight: 700, fontSize: 5.4, letterSpacing: 0.3, color: C.tealText, textTransform: "uppercase", backgroundColor: C.tealSoft, borderRadius: 4, paddingVertical: 1, paddingHorizontal: 3 },

  table: { borderWidth: 1, borderColor: C.border, borderRadius: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  tableRowLast: { flexDirection: "row" },
  tableHeaderCell: { flex: 1, paddingVertical: 2.5, paddingHorizontal: 4, fontFamily: "Inter", fontWeight: 600, fontSize: 6.2, backgroundColor: C.surface2, color: C.sec },
  tableCell: { flex: 1, paddingVertical: 2.5, paddingHorizontal: 4, fontSize: 6.2, color: C.ink },
  tableCellFirst: { flex: 2.4 },
  tableMore: { fontSize: 6.4, color: C.muted, marginTop: 2 },

  empty: { fontSize: 7, color: C.muted, paddingVertical: 3 },
  footer: { position: "absolute", bottom: 10, left: 20, right: 20, fontSize: 6.3, color: C.muted, textAlign: "center" },
});

const S = REPORT_STYLES;

// ---- pequenos utilitários -------------------------------------------------

export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

/** kind do gauge — react-pdf não tem "number"; ratio vira decimal. */
export function gaugeKind(kind: MetricKind): "money" | "percent" | "decimal" {
  return kind === "number" ? "decimal" : kind;
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
export function SvgText(props: SvgTextProps) {
  return <Text {...(props as unknown as ComponentProps<typeof Text>)} />;
}

export function CompassNode({ shape, ink }: { shape: CompassShape; ink: string }) {
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

export function DeltaText({ current, previous, inverse }: { current: NullableMetric; previous: NullableMetric; inverse: boolean }) {
  const value = acquisitionDelta(current, previous);
  if (value === null) return <Text style={[S.delta, S.deltaNeutral]}>Sem comparativo</Text>;
  const good = inverse ? value <= 0 : value >= 0;
  return (
    <Text style={[S.delta, good ? S.deltaGood : S.deltaBad]}>
      {value >= 0 ? "↑" : "↓"} {formatAcquisitionValue(Math.abs(value), "decimal")}% vs. anterior
    </Text>
  );
}

export function KpiCard({
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

export function FunnelSvg({ labels, values }: { labels: string[]; values: NullableMetric[] }) {
  const bands = funnelBandLayout(values);
  // rates[i] = taxa da transição da etapa i para a i+1 — mesmo indexado do
  // `stageRates` de FunnelChart (que faz `values.slice(1)`).
  const rates = values.slice(1).map((v, i) => acquisitionRateLabel(v, values[i]));
  const height = funnelChartHeight(labels.length);
  const width = 210;
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
            <SvgText x={band.labelAt.x} y={band.labelAt.y} fill={C.sec} fontFamily="Inter" fontWeight={600} fontSize={6.5}>
              {label.toUpperCase()}
            </SvgText>
            <SvgText x={band.valueAt.x} y={band.valueAt.y} fill={C.ink} fontFamily="Fraunces" fontWeight={600} fontSize={13}>
              {formatAcquisitionValue(values[i])}
            </SvgText>
            {band.rateAt ? (
              <SvgText x={band.rateAt.x} y={band.rateAt.y} textAnchor="middle" fill={C.muted} fontFamily="Inter" fontWeight={600} fontSize={6.5}>
                {rates[i]}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

export function ResultPanel({
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
