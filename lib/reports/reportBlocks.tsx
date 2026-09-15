// Blocos visuais dos relatórios v2 (modelo "North — relatórios revisados").
//
// Uma família só para os dois PDFs: fundo branco, verde dessaturado como
// identidade, números grandes em Fraunces, rótulos pequenos. A diferença entre
// o relatório de anúncios e o de resultados está na ORDEM e no FOCO, não num
// vocabulário visual próprio de cada um.
//
// Regras que estes componentes impõem por construção:
// - variação só ganha cor pelo `tone` que a leitura calculou (adsInsights /
//   conversionFocus) — investimento chega aqui como "neutral";
// - texto usa sempre tinta de texto, nunca a cor da série;
// - o funil tem larguras FIXAS decrescentes (legibilidade), e a taxa fica
//   ENTRE as etapas, dita por extenso.

import { Defs, G, Line, LinearGradient, Path, Rect, StyleSheet, Stop, Svg, Text, View } from "@react-pdf/renderer";
import { REPORT_COLORS as C, REPORT_SERIES, COMPASS_VIEWBOX, compassShapes } from "./reportTheme";
import { CompassNode, SvgText } from "./reportComponents";
import type { Tone } from "./adsInsights";

const SOFT = "#f3f7f5";
const LINE_SOFT = "#edf1ef";

export const toneColor = (tone: Tone | undefined) => (tone === "good" ? C.tealText : tone === "bad" ? C.danger : C.muted);

export const V = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 32, fontFamily: "Inter", fontSize: 7.2, color: C.ink, backgroundColor: "#ffffff" },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 8 },
  headerLeft: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  eyebrow: { fontSize: 6.2, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 700, color: C.muted },
  h1: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 19, color: C.ink, marginTop: 2 },
  sub: { fontSize: 6.8, color: C.muted, marginTop: 2 },
  pill: { fontSize: 6.4, fontWeight: 600, color: C.sec, borderWidth: 1, borderColor: C.border, backgroundColor: SOFT, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 7 },

  section: { marginTop: 11 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 5 },
  sectTitle: { fontSize: 6.4, letterSpacing: 1.1, textTransform: "uppercase", fontWeight: 700, color: C.tealText },
  micro: { fontSize: 6.2, color: C.muted },

  band: { flexDirection: "row", borderWidth: 1, borderColor: C.border, borderRadius: 9 },
  kpi: { flex: 1, paddingVertical: 7, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: C.border },
  kpiLast: { borderRightWidth: 0 },
  kpiHero: { backgroundColor: SOFT, flex: 1.25 },
  lab: { fontSize: 5.8, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, fontWeight: 700 },
  val: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 13.5, color: C.ink, marginTop: 3 },
  valHero: { fontSize: 17 },
  delta: { fontSize: 6.2, marginTop: 3, fontWeight: 600 },

  insightRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  insight: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 7 },
  insightPrimary: { flex: 1.45, backgroundColor: SOFT },
  insT: { fontSize: 5.8, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, fontWeight: 700 },
  insH: { fontSize: 8, fontWeight: 700, marginTop: 3, lineHeight: 1.25, color: C.ink },
  insB: { fontSize: 6.4, color: C.muted, marginTop: 3, lineHeight: 1.35 },

  funnelWrap: { flexDirection: "row", gap: 12, alignItems: "center" },
  funnelCol: { flex: 1.1, alignItems: "center" },
  sideStack: { flex: 0.9, gap: 6 },
  gap: { fontSize: 6.1, color: C.muted, height: 11, textAlign: "center", paddingTop: 2 },

  stat: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 7 },
  statSoft: { backgroundColor: SOFT },
  statVal: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 12.5, marginTop: 2, color: C.ink },
  statDetail: { fontSize: 6.3, color: C.muted, marginTop: 3, lineHeight: 1.35 },

  panels: { flexDirection: "row", gap: 7 },
  panel: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8 },
  panelHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: SOFT, paddingVertical: 5, paddingHorizontal: 7, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  panelTitle: { fontSize: 7.6, fontWeight: 700, color: C.ink },
  panelMeta: { fontSize: 6.1, color: C.muted },
  slotGrid: { flexDirection: "row", flexWrap: "wrap" },
  slot: { width: "33.33%", paddingVertical: 5, paddingHorizontal: 7, borderTopWidth: 1, borderTopColor: LINE_SOFT },
  slotLab: { fontSize: 5.6, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  slotVal: { fontSize: 8.6, fontWeight: 700, marginTop: 2, color: C.ink },
  slotDelta: { fontSize: 5.9, marginTop: 2, fontWeight: 600 },
  slotNote: { fontSize: 5.6, color: C.muted, marginTop: 2, lineHeight: 1.3 },

  cards: { flexDirection: "row", gap: 6 },
  card: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 7 },
  cardTag: { fontSize: 5.8, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 },
  cardName: { fontSize: 7.3, fontWeight: 700, marginTop: 3, lineHeight: 1.2, color: C.ink },
  cardBig: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 12, marginTop: 3, color: C.ink },
  cardSmall: { fontSize: 6.2, color: C.muted, marginTop: 2, lineHeight: 1.3 },

  table: { borderWidth: 1, borderColor: C.border, borderRadius: 8, marginTop: 6 },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: LINE_SOFT },
  thRow: { flexDirection: "row", backgroundColor: SOFT, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  th: { paddingVertical: 4, paddingHorizontal: 6, fontSize: 5.7, textTransform: "uppercase", letterSpacing: 0.4, color: C.sec, fontWeight: 700 },
  td: { paddingVertical: 4, paddingHorizontal: 6, fontSize: 6.6, color: C.ink },
  right: { textAlign: "right" },

  split: { flexDirection: "row", gap: 8 },
  summary: { flex: 1.15, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 8, backgroundColor: SOFT },
  summaryHeadline: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 14, marginTop: 2, color: C.ink },
  summaryCaption: { fontSize: 6.4, color: C.muted, marginTop: 2 },
  moneyRow: { flexDirection: "row", gap: 6, marginTop: 7 },
  money: { flex: 1, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 5 },
  moneyB: { fontSize: 8.6, fontWeight: 700, color: C.ink },
  moneySpan: { fontSize: 5.6, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  box: { flex: 0.85, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 8 },
  boxRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3.5, borderBottomWidth: 1, borderBottomColor: LINE_SOFT },
  boxRowLast: { borderBottomWidth: 0 },
  boxLeft: { fontSize: 6.7, color: C.sec },
  boxRight: { fontSize: 6.7, fontWeight: 700, color: C.ink },
  lowNote: { marginTop: 5, fontSize: 5.8, color: C.muted, lineHeight: 1.35 },

  legendRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendSwatch: { width: 6, height: 6, borderRadius: 1.5 },
  legendLabel: { fontSize: 6.2, color: C.sec },

  note: { fontSize: 6.2, color: C.muted, marginTop: 4, lineHeight: 1.35 },
  footer: { position: "absolute", bottom: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", gap: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 5 },
  footerText: { fontSize: 5.8, color: C.muted },
});

// ---- cabeçalho, seção, rodapé ---------------------------------------------------

export function PageHeader({ eyebrow, title, subtitle, pill }: { eyebrow: string; title: string; subtitle: string; pill: string }) {
  return (
    <View style={V.header}>
      <View style={V.headerLeft}>
        <Svg viewBox={`0 0 ${COMPASS_VIEWBOX} ${COMPASS_VIEWBOX}`} style={{ width: 22, height: 22, marginTop: 3 }}>
          {compassShapes.map((shape, i) => <CompassNode key={i} shape={shape} ink={C.tealStrong} />)}
        </Svg>
        <View>
          <Text style={V.eyebrow}>{eyebrow}</Text>
          <Text style={V.h1}>{title}</Text>
          <Text style={V.sub}>{subtitle}</Text>
        </View>
      </View>
      <Text style={V.pill}>{pill}</Text>
    </View>
  );
}

export function SectionHead({ title, micro }: { title: string; micro?: string }) {
  return (
    <View style={V.sectionHead}>
      <Text style={V.sectTitle}>{title}</Text>
      {micro ? <Text style={V.micro}>{micro}</Text> : null}
    </View>
  );
}

export function FooterNote({ left, right }: { left: string; right: string }) {
  return (
    <View style={V.footer} fixed>
      <Text style={V.footerText}>{left}</Text>
      <Text style={[V.footerText, { textAlign: "right", maxWidth: 330 }]}>{right}</Text>
    </View>
  );
}

// ---- faixa de KPIs --------------------------------------------------------------

export type BandItem = { label: string; value: string; delta?: { text: string; tone: Tone }; hint?: string };

/** `heroIndex` é o indicador principal: fundo suave e número maior. */
export function KpiBand({ items, heroIndex = 0 }: { items: BandItem[]; heroIndex?: number }) {
  return (
    <View style={V.band} wrap={false}>
      {items.map((item, i) => {
        const hero = i === heroIndex;
        return (
          <View key={item.label} style={[V.kpi, ...(hero ? [V.kpiHero] : []), ...(i === items.length - 1 ? [V.kpiLast] : [])]}>
            <Text style={V.lab}>{item.label}</Text>
            <Text style={[V.val, ...(hero ? [V.valHero] : [])]}>{item.value}</Text>
            {item.delta ? <Text style={[V.delta, { color: toneColor(item.delta.tone) }]}>{item.delta.text}</Text> : null}
            {item.hint ? <Text style={[V.delta, { color: C.muted, fontWeight: 400 }]}>{item.hint}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

// ---- leitura em cartões -------------------------------------------------------------

export type InsightItem = { title: string; headline: string; body?: string };

export function InsightRow({ primary, cards }: { primary: InsightItem; cards: InsightItem[] }) {
  return (
    <View style={V.insightRow} wrap={false}>
      <View style={[V.insight, V.insightPrimary]}>
        <Text style={V.insT}>{primary.title}</Text>
        <Text style={V.insH}>{primary.headline}</Text>
        {primary.body ? <Text style={V.insB}>{primary.body}</Text> : null}
      </View>
      {cards.map((c) => (
        <View key={c.title} style={V.insight}>
          <Text style={V.insT}>{c.title}</Text>
          <Text style={V.insH}>{c.headline}</Text>
          {c.body ? <Text style={V.insB}>{c.body}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ---- funil ------------------------------------------------------------------------

export type FunnelStageView = { label: string; value: string };

const BAND_H = 25;

/** Trapézios de largura FIXA decrescente (100% → 42%): o funil é para ler, não
 *  para medir — proporcional, a última etapa de "23" sumiria perto de "16.409". */
export function TrapezoidFunnel({ stages, gaps, width = 250 }: { stages: FunnelStageView[]; gaps: string[]; width?: number }) {
  const n = stages.length;
  const widthAt = (i: number) => (n <= 1 ? 1 : 1 - (i * 0.58) / (n - 1));
  return (
    <View style={{ width, alignItems: "center" }} wrap={false}>
      {stages.map((stage, i) => {
        const w = width * widthAt(i);
        const inset = w * 0.07;
        return (
          <View key={stage.label} style={{ alignItems: "center" }}>
            <View style={{ width: w, height: BAND_H, position: "relative" }}>
              <Svg viewBox={`0 0 ${w} ${BAND_H}`} style={{ position: "absolute", top: 0, left: 0, width: w, height: BAND_H }}>
                <Defs>
                  <LinearGradient id={`band${i}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor="#3f7a72" />
                    <Stop offset="100%" stopColor="#2f625d" />
                  </LinearGradient>
                </Defs>
                <Path d={`M 0 0 L ${w} 0 L ${w - inset} ${BAND_H} L ${inset} ${BAND_H} Z`} fill={`url(#band${i})`} />
              </Svg>
              <View style={{ position: "absolute", top: 0, left: 0, width: w, height: BAND_H, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 }}>
                <Text style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: 11, color: "#ffffff" }}>{stage.value}</Text>
                <Text style={{ fontSize: 5.4, color: "#ffffff", textTransform: "uppercase", letterSpacing: 0.5 }}>{stage.label}</Text>
              </View>
            </View>
            {i < n - 1 ? <Text style={[V.gap, { width }]}>{gaps[i] ?? ""}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

// ---- pilha de cartões -------------------------------------------------------------

export type StatItem = { label: string; value: string; detail?: string; tone?: Tone; soft?: boolean };

export function StatStack({ items }: { items: StatItem[] }) {
  return (
    <View style={V.sideStack}>
      {items.map((s) => (
        <View key={s.label} style={[V.stat, ...(s.soft ? [V.statSoft] : [])]} wrap={false}>
          <Text style={V.lab}>{s.label}</Text>
          <Text style={[V.statVal, ...(s.tone === "bad" ? [{ color: C.danger }] : [])]}>{s.value}</Text>
          {s.detail ? <Text style={V.statDetail}>{s.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ---- painéis por objetivo -----------------------------------------------------------

export type PanelSlot = { label: string; value: string; delta?: { text: string; tone: Tone }; note?: string };
export type PanelView = { title: string; meta: string; slots: PanelSlot[] };

export function ObjectivePanels({ panels }: { panels: PanelView[] }) {
  return (
    <View style={V.panels} wrap={false}>
      {panels.map((p) => (
        <View key={p.title} style={V.panel}>
          <View style={V.panelHead}>
            <Text style={V.panelTitle}>{p.title}</Text>
            <Text style={V.panelMeta}>{p.meta}</Text>
          </View>
          <View style={V.slotGrid}>
            {p.slots.map((s) => (
              <View key={s.label} style={[V.slot, { width: panels.length === 1 ? "16.66%" : "33.33%" }]}>
                <Text style={V.slotLab}>{s.label}</Text>
                <Text style={[V.slotVal, ...(s.note ? [{ color: C.danger }] : [])]}>{s.value}</Text>
                {s.delta ? <Text style={[V.slotDelta, { color: toneColor(s.delta.tone) }]}>{s.delta.text}</Text> : null}
                {s.note ? <Text style={V.slotNote}>{s.note}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---- criativos ------------------------------------------------------------------------

export type CardView = { tag: string; tone: Tone; name: string; value: string; detail: string };

export function HighlightCards({ items }: { items: CardView[] }) {
  if (!items.length) return null;
  return (
    <View style={V.cards} wrap={false}>
      {items.map((c) => (
        <View key={c.tag + c.name} style={V.card}>
          <Text style={[V.cardTag, { color: c.tone === "bad" ? C.danger : C.tealText }]}>{c.tag}</Text>
          <Text style={V.cardName}>{c.name}</Text>
          <Text style={V.cardBig}>{c.value}</Text>
          <Text style={V.cardSmall}>{c.detail}</Text>
        </View>
      ))}
    </View>
  );
}

export type TableColumn = { key: string; label: string; flex?: number; align?: "right" };
export type TableRowView = { cells: Record<string, string>; tone?: Record<string, Tone> };

export function DataTable({ columns, rows }: { columns: TableColumn[]; rows: TableRowView[] }) {
  return (
    <View style={V.table}>
      <View style={V.thRow}>
        {columns.map((c) => (
          <Text key={c.key} style={[V.th, { flex: c.flex ?? 1 }, ...(c.align === "right" ? [V.right] : [])]}>{c.label}</Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={V.tr} wrap={false}>
          {columns.map((c) => (
            <Text
              key={c.key}
              style={[V.td, { flex: c.flex ?? 1 }, ...(c.align === "right" ? [V.right] : []), ...(r.tone?.[c.key] ? [{ color: toneColor(r.tone[c.key]), fontWeight: 700 as const }] : [])]}
            >
              {r.cells[c.key] ?? "—"}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---- histórico ----------------------------------------------------------------------

/** Colunas agrupadas por semana, UM eixo, cor por série em ordem fixa, valor
 *  escrito em cada coluna (poucas colunas por construção — no máximo 8 semanas).
 *  Valor ausente não vira coluna zero: fica "n/d" na base. */
export function HistoryBars({ periods, series, width = 250, height = 92 }: { periods: string[]; series: { label: string; values: (number | null)[] }[]; width?: number; height?: number }) {
  const top = 12;
  const bottom = 14;
  const plotH = height - top - bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const groupW = width / periods.length;
  const barW = Math.min(18, (groupW * 0.62) / series.length);
  const barGap = 2;
  const groupInner = series.length * barW + (series.length - 1) * barGap;
  return (
    <View wrap={false}>
      <Svg viewBox={`0 0 ${width} ${height}`} style={{ width, height }}>
        <Line x1={0} y1={top + plotH} x2={width} y2={top + plotH} stroke={C.borderStrong} strokeWidth={0.75} />
        {periods.map((period, gi) => {
          const gx = gi * groupW + (groupW - groupInner) / 2;
          return (
            <G key={period}>
              {series.map((s, si) => {
                const v = s.values[gi];
                const x = gx + si * (barW + barGap);
                if (v === null) {
                  return <SvgText key={s.label} x={x + barW / 2} y={top + plotH - 2} textAnchor="middle" fill={C.muted} fontFamily="Inter" fontSize={5.2}>n/d</SvgText>;
                }
                const h = Math.max(1.5, (v / max) * plotH);
                return (
                  <G key={s.label}>
                    <Rect x={x} y={top + plotH - h} width={barW} height={h} rx={1.5} fill={REPORT_SERIES[si % REPORT_SERIES.length]} />
                    <SvgText x={x + barW / 2} y={top + plotH - h - 2.5} textAnchor="middle" fill={C.ink} fontFamily="Inter" fontWeight={600} fontSize={6}>
                      {v.toLocaleString("pt-BR")}
                    </SvgText>
                  </G>
                );
              })}
              <SvgText x={gi * groupW + groupW / 2} y={height - 3} textAnchor="middle" fill={C.muted} fontFamily="Inter" fontSize={5.8}>
                {period}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      {series.length >= 2 ? (
        <View style={V.legendRow}>
          {series.map((s, si) => (
            <View key={s.label} style={V.legendItem}>
              <View style={[V.legendSwatch, { backgroundColor: REPORT_SERIES[si % REPORT_SERIES.length] }]} />
              <Text style={V.legendLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---- resumo comercial + caixa lateral ------------------------------------------------

export function SummaryBox({ label, headline, caption, money, flex }: { label: string; headline: string; caption: string; money: { value: string; label: string }[]; flex?: number }) {
  return (
    <View style={[V.summary, ...(flex !== undefined ? [{ flex }] : [])]} wrap={false}>
      <Text style={V.lab}>{label}</Text>
      <Text style={V.summaryHeadline}>{headline}</Text>
      <Text style={V.summaryCaption}>{caption}</Text>
      {money.length ? (
        <View style={V.moneyRow}>
          {money.map((m) => (
            <View key={m.label} style={V.money}>
              <Text style={V.moneyB}>{m.value}</Text>
              <Text style={V.moneySpan}>{m.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ListBox({ label, rows, note, children, flex }: { label: string; rows: { left: string; right: string }[]; note?: string; children?: React.ReactNode; flex?: number }) {
  return (
    <View style={[V.box, ...(flex !== undefined ? [{ flex }] : [])]} wrap={false}>
      <Text style={V.lab}>{label}</Text>
      {rows.map((r, i) => (
        <View key={r.left} style={[V.boxRow, ...(i === rows.length - 1 ? [V.boxRowLast] : [])]}>
          <Text style={V.boxLeft}>{r.left}</Text>
          <Text style={V.boxRight}>{r.right}</Text>
        </View>
      ))}
      {children}
      {note ? <Text style={V.lowNote}>{note}</Text> : null}
    </View>
  );
}
