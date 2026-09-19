// Blocos visuais dos relatórios v3 (docs/reporting/adaptive-report-plan.md §13).
//
// Sistema:
// - Escala tipográfica de 6 degraus: 6,5 · 7,5 · 9 · 12 · 20 · 30 pt. Nada abaixo
//   de 6,5 pt.
// - Números em Inter (a skill dataviz cataloga serif na figura principal como
//   anti-padrão); Fraunces só no título do relatório.
// - Ritmo de 4 pt; largura útil A4 ≈ 531 pt.
// - Cor: uma matiz (teal) em degraus para séries com ordem — o validador de paleta
//   reprovou o par categórico teal × azul (ΔE 11,6). Texto sempre em tinta de
//   texto; cor só na marca.
// - Componentes crescem com o conteúdo; a página flui.

import { Circle, G, Image, Line, Link, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { REPORT_COLORS as C, COMPASS_VIEWBOX, compassShapes } from "./reportTheme";
import { CompassNode, SvgText } from "./reportComponents";
import { funnelWidths, type Delta, type Tone } from "./adsInsights";

export const W = 531; // largura útil

/** Degraus da matiz de identidade, do mais escuro ao mais claro (todos ≥ 3:1 no branco). */
export const TEAL = { d1: "#244f4a", d2: "#2f625d", d3: "#3f7a72", d4: "#5e9c93", soft: "#e6f0ec", wash: "#f3f7f5" } as const;
const INK = C.ink;
const SEC = C.sec;
const MUTED = C.muted;
const LINE = "#e3e8e5";

/** Frase gerada que começa pelo nome do anúncio ("ad promos agosto liderou…")
 *  sai com maiúscula inicial; o nome em si não é alterado no meio da frase. */
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const toneColor = (tone: Tone | undefined) => (tone === "good" ? C.tealText : tone === "bad" ? C.danger : MUTED);

export const T = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 32, fontFamily: "Inter", fontSize: 7.5, color: INK, backgroundColor: "#ffffff" },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: LINE },
  headerLeft: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  eyebrow: { fontSize: 6.5, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, color: MUTED },
  title: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 20, color: INK, marginTop: 2 },
  subtitle: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  pill: { fontSize: 6.5, fontWeight: 600, color: SEC, borderWidth: 1, borderColor: LINE, backgroundColor: TEAL.wash, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },

  section: { marginTop: 16 },
  sectionTitle: { fontSize: 9, fontWeight: 700, color: INK },
  sectionAside: { fontSize: 7.5, color: MUTED },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8, gap: 12 },

  headline: { fontSize: 12, fontWeight: 600, color: INK, lineHeight: 1.3, marginTop: 12 },

  heroValue: { fontSize: 30, fontWeight: 700, color: INK, lineHeight: 1 },
  heroLabel: { fontSize: 9, fontWeight: 600, color: SEC, marginTop: 2 },
  heroCaption: { fontSize: 9, color: SEC, marginTop: 6, lineHeight: 1.35 },

  figureRow: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  figure: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: LINE },
  figureLast: { borderRightWidth: 0 },
  figureLabel: { fontSize: 6.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 },
  figureValue: { fontSize: 13, fontWeight: 700, color: INK, marginTop: 3 },
  figureDelta: { fontSize: 6.5, fontWeight: 600, marginTop: 2 },

  alert: { flexDirection: "row", gap: 8, marginTop: 12, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: "#fbefec", borderRadius: 4 },
  alertBar: { width: 2.5, borderRadius: 2, backgroundColor: C.danger },
  alertText: { fontSize: 9, color: INK, flex: 1, lineHeight: 1.35 },

  analysis: { gap: 6 },
  analysisRow: { flexDirection: "row", gap: 6 },
  analysisDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: TEAL.d3, marginTop: 4 },
  analysisText: { fontSize: 9, color: INK, lineHeight: 1.35, flex: 1 },
  narrativeText: { fontSize: 9, color: INK, lineHeight: 1.45, marginBottom: 4 },

  twoCol: { flexDirection: "row", gap: 16 },

  table: { borderTopWidth: 1, borderTopColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, alignItems: "center" },
  trHighlight: { backgroundColor: TEAL.wash },
  th: { paddingVertical: 4, paddingHorizontal: 5, fontSize: 6.5, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.1 },
  td: { paddingVertical: 5, paddingHorizontal: 5, fontSize: 7.5, color: INK },
  tdStrong: { fontWeight: 700 },
  tdDelta: { fontSize: 6.5, fontWeight: 600, marginTop: 1 },
  right: { textAlign: "right" },

  cardRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  card: { borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 8, gap: 8 },
  cardBadge: { fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  cardName: { fontSize: 9, fontWeight: 700, color: INK, lineHeight: 1.2 },
  cardMetricValue: { fontSize: 12, fontWeight: 700, color: INK },
  cardMetricLabel: { fontSize: 6.5, color: MUTED },
  cardLink: { fontSize: 6.5, color: C.tealText, textDecoration: "none" },

  note: { fontSize: 7.5, color: MUTED, marginTop: 6, lineHeight: 1.35 },
  legendRow: { flexDirection: "row", gap: 12, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { width: 8, height: 8, borderRadius: 2 },
  legendLabel: { fontSize: 7.5, color: SEC },

  footer: { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", gap: 16, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 },
  footerText: { fontSize: 6.5, color: MUTED },
});

// ---- estrutura --------------------------------------------------------------------------

export function PageHeader({ eyebrow, title, subtitle, pill }: { eyebrow: string; title: string; subtitle: string; pill: string }) {
  return (
    <View style={T.header}>
      <View style={T.headerLeft}>
        <Svg viewBox={`0 0 ${COMPASS_VIEWBOX} ${COMPASS_VIEWBOX}`} style={{ width: 22, height: 22, marginTop: 4 }}>
          {compassShapes.map((shape, i) => <CompassNode key={i} shape={shape} ink={C.tealStrong} />)}
        </Svg>
        <View>
          <Text style={T.eyebrow}>{eyebrow}</Text>
          <Text style={T.title}>{title}</Text>
          <Text style={T.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <Text style={T.pill}>{pill}</Text>
    </View>
  );
}

/** `lead` é o primeiro bloco da seção, preso ao título num bloco que não quebra:
 *  o título nunca fica sozinho no pé da página (o `minPresenceAhead` do react-pdf
 *  não segurou quando o bloco seguinte era uma linha de cartões). */
export function Section({ title, aside, lead, children, wrap = true, breakBefore = false }: { title: string; aside?: string; lead?: ReactNode; children?: ReactNode; wrap?: boolean; breakBefore?: boolean }) {
  const head = (
    <View style={T.sectionHead} minPresenceAhead={60}>
      <Text style={T.sectionTitle}>{cap(title)}</Text>
      {aside ? <Text style={T.sectionAside}>{aside}</Text> : null}
    </View>
  );
      return (
        <View style={T.section} wrap={wrap} break={breakBefore}>
          {lead ? <><View wrap={false}>{head}</View>{lead}</> : head}
      {children}
    </View>
  );
}

export function Footer({ left, note }: { left: string; note?: string | null }) {
  return (
    <View style={T.footer} fixed>
      <Text style={T.footerText}>{left}</Text>
      {note ? <Text style={[T.footerText, { textAlign: "right", maxWidth: 360 }]}>{note}</Text> : null}
      <Text style={T.footerText} render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${pageNumber}/${totalPages}` : "")} />
    </View>
  );
}

// ---- figuras ------------------------------------------------------------------------------

export function Headline({ text }: { text: string }) {
  return <Text style={T.headline}>{text}</Text>;
}

export function HeroFigure({ value, label, caption, delta, aside }: { value: string; label: string; caption?: string; delta?: Delta | null; aside?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: 16, marginTop: 14, alignItems: "flex-end" }} wrap={false}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          <Text style={T.heroValue}>{value}</Text>
          {delta && delta.pct !== null ? <Text style={[T.figureDelta, { fontSize: 9, color: toneColor(delta.tone), marginBottom: 3 }]}>{delta.text} vs. semana anterior</Text> : null}
        </View>
        <Text style={T.heroLabel}>{label}</Text>
        {caption ? <Text style={T.heroCaption}>{caption}</Text> : null}
      </View>
      {aside ? <View style={{ width: 200 }}>{aside}</View> : null}
    </View>
  );
}

export type FigureItem = { label: string; value: string; delta?: Delta | null; hint?: string };

export function FigureRow({ items }: { items: FigureItem[] }) {
  if (!items.length) return null;
  return (
    <View style={[T.figureRow, { marginTop: 14 }]} wrap={false}>
      {items.map((f, i) => (
        <View key={f.label} style={[T.figure, ...(i === items.length - 1 ? [T.figureLast] : [])]}>
          <Text style={T.figureLabel}>{f.label}</Text>
          <Text style={T.figureValue}>{f.value}</Text>
          {f.delta && f.delta.pct !== null ? <Text style={[T.figureDelta, { color: toneColor(f.delta.tone) }]}>{f.delta.text}</Text> : null}
          {f.hint ? <Text style={[T.figureDelta, { color: MUTED, fontWeight: 400 }]}>{f.hint}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function AlertLine({ text }: { text: string }) {
  return (
    <View style={T.alert} wrap={false}>
      <View style={T.alertBar} />
      <Text style={T.alertText}>{text}</Text>
    </View>
  );
}

export function AnalysisList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={T.analysis}>
      {items.map((t) => (
        <View key={t} style={T.analysisRow} wrap={false}>
          <View style={T.analysisDot} />
          <Text style={T.analysisText}>{cap(t)}</Text>
        </View>
      ))}
    </View>
  );
}

export function ComparisonFigure({ items }: { items: { label: string; from: string; to: string; change: string; tone: Tone }[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }} wrap={false}>
      {items.map((it) => (
        <View key={it.label} style={{ minWidth: 150 }}>
          <Text style={T.figureLabel}>{it.label}</Text>
          <Text style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 3 }}>{it.from} → {it.to}</Text>
          <Text style={[T.figureDelta, { color: toneColor(it.tone), fontSize: 7.5 }]}>{it.change} em relação à semana anterior</Text>
        </View>
      ))}
    </View>
  );
}

// ---- funil ---------------------------------------------------------------------------------

export type FunnelView = { label: string; value: string; numeric: number; base?: boolean };

const STAGE_H = 28;
const GAP_H = 13;

/** Trapézios proporcionais (escala log) com o número dentro quando cabe e à
 *  direita quando não; a placa-base (ex.: total do perfil) fecha o funil. */
export function ProportionalFunnel({ stages, gaps, width = 300 }: { stages: FunnelView[]; gaps: string[]; width?: number }) {
  const flow = stages.filter((s) => !s.base);
  const base = stages.find((s) => s.base);
  const widths = funnelWidths(flow.map((s) => s.numeric));
  const fills = [TEAL.d1, TEAL.d2, TEAL.d3, TEAL.d3, TEAL.d4, TEAL.d4];
  return (
    <View style={{ width, alignItems: "center" }} wrap={false}>
      {flow.map((stage, i) => {
        const top = width * widths[i];
        const bottom = width * (i + 1 < flow.length ? widths[i + 1] : Math.max(0.3, widths[i] - 0.08));
        // Em funis estreitos há uma coluna de insights ao lado. Etiquetas de
        // estágios pequenos não podem escapar pela direita e ocupar essa
        // coluna; centralize-as na faixa completa do funil.
        const inside = top >= 130 || width < W;
        return (
          <View key={stage.label} style={{ alignItems: "center", width }}>
            <View style={{ width, height: STAGE_H, position: "relative" }}>
              <Svg viewBox={`0 0 ${width} ${STAGE_H}`} style={{ position: "absolute", top: 0, left: 0, width, height: STAGE_H }}>
                <Path
                  d={`M ${(width - top) / 2} 0 L ${(width + top) / 2} 0 L ${(width + bottom) / 2} ${STAGE_H} L ${(width - bottom) / 2} ${STAGE_H} Z`}
                  fill={fills[Math.min(i, fills.length - 1)]}
                />
              </Svg>
              {inside ? (
                <View style={{ position: "absolute", top: 0, left: 0, width, height: STAGE_H, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: 700, color: "#ffffff" }}>{stage.value}</Text>
                  <Text style={{ fontSize: 6.5, fontWeight: 600, color: "#ffffff", textTransform: "uppercase", letterSpacing: 0.4 }}>{stage.label}</Text>
                </View>
              ) : (
                <View style={{ position: "absolute", top: 0, left: (width + top) / 2 + 6, height: STAGE_H, justifyContent: "center" }}>
                  <Text style={{ fontSize: 12, fontWeight: 700, color: INK }}>{stage.value}</Text>
                  <Text style={{ fontSize: 6.5, fontWeight: 600, color: SEC, textTransform: "uppercase", letterSpacing: 0.4 }}>{stage.label}</Text>
                </View>
              )}
            </View>
            {i < flow.length - 1 || base ? (
              <Text style={{ fontSize: 7.5, color: MUTED, height: GAP_H, paddingTop: 2, textAlign: "center" }}>{gaps[i] ?? ""}</Text>
            ) : null}
          </View>
        );
      })}
      {base ? (
        <View style={{ width: width * 0.62, borderRadius: 4, backgroundColor: TEAL.soft, paddingVertical: 6, alignItems: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: 700, color: INK }}>{base.value}</Text>
          <Text style={{ fontSize: 6.5, fontWeight: 600, color: SEC, textTransform: "uppercase", letterSpacing: 0.4 }}>{base.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---- verba × resultado ----------------------------------------------------------------------

/** Barra pareada por objetivo: parte da verba (tom médio) e parte do resultado
 *  (tom escuro) na mesma escala de 0–100%. Mostra concentração sem frase. */
export function ShareBars({ rows, resultLabel }: { rows: { label: string; spend: number; result: number | null }[]; resultLabel: string }) {
  const labelW = 110;
  const barW = W - labelW - 40;
  const bar = (pct: number, fill: string, text: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", height: 10 }}>
      <View style={{ width: Math.max(2, (barW * pct) / 100), height: 8, backgroundColor: fill, borderTopRightRadius: 2, borderBottomRightRadius: 2 }} />
      <Text style={{ fontSize: 7.5, color: INK, marginLeft: 4 }}>{text}</Text>
    </View>
  );
  return (
    <View wrap={false}>
      {rows.map((r) => (
        <View key={r.label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: LINE }}>
          <Text style={{ width: labelW, fontSize: 7.5, fontWeight: 600, color: INK }}>{r.label}</Text>
          <View style={{ gap: 2 }}>
            {bar(r.spend, TEAL.d4, `${Math.round(r.spend)}%`)}
            {r.result !== null ? bar(r.result, TEAL.d1, `${Math.round(r.result)}%`) : null}
          </View>
        </View>
      ))}
      <View style={T.legendRow}>
        <View style={T.legendItem}><View style={[T.legendSwatch, { backgroundColor: TEAL.d4 }]} /><Text style={T.legendLabel}>Parte da verba</Text></View>
        <View style={T.legendItem}><View style={[T.legendSwatch, { backgroundColor: TEAL.d1 }]} /><Text style={T.legendLabel}>{resultLabel}</Text></View>
      </View>
    </View>
  );
}

// ---- tabela ---------------------------------------------------------------------------------

export type Cell = { text: string; delta?: Delta | null; strong?: boolean; tone?: Tone; image?: string | null };
export type Column = { key: string; label: string; flex?: number; width?: number; align?: "right" };

export function DataTable({ columns, rows, highlight }: { columns: Column[]; rows: Record<string, Cell>[]; highlight?: (i: number) => boolean }) {
  const colStyle = (c: Column) => (c.width ? { width: c.width } : { flex: c.flex ?? 1 });
  return (
    <View style={T.table}>
      <View style={T.tr} fixed={false} wrap={false}>
        {columns.map((c) => <Text key={c.key} style={[T.th, colStyle(c), ...(c.align === "right" ? [T.right] : [])]}>{c.label}</Text>)}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={[T.tr, ...(highlight?.(i) ? [T.trHighlight] : [])]} wrap={false}>
          {columns.map((c) => {
            const cell = row[c.key] ?? { text: "—" };
            if (cell.image !== undefined) {
              return (
                <View key={c.key} style={[{ paddingVertical: 3, paddingHorizontal: 4 }, colStyle(c)]}>
                  <Thumb src={cell.image} size={18} />
                </View>
              );
            }
            return (
              <View key={c.key} style={[T.td, colStyle(c)]}>
                <Text style={[...(c.align === "right" ? [T.right] : []), ...(cell.strong ? [T.tdStrong] : []), ...(cell.tone ? [{ color: toneColor(cell.tone), fontWeight: 700 as const }] : [])]}>{cell.text}</Text>
                {cell.delta && cell.delta.pct !== null ? (
                  <Text style={[T.tdDelta, { color: toneColor(cell.delta.tone) }, ...(c.align === "right" ? [T.right] : [])]}>{cell.delta.text}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---- criativos ------------------------------------------------------------------------------

export function Thumb({ src, size, kind }: { src: string | null | undefined; size: number; kind?: string | null }) {
  if (src) return <Image src={src} style={{ width: size, height: size, borderRadius: size > 30 ? 4 : 2, objectFit: "cover" }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size > 30 ? 4 : 2, backgroundColor: TEAL.soft, alignItems: "center", justifyContent: "center" }}>
      {size > 30 ? <Text style={{ fontSize: 6.5, color: SEC, fontWeight: 600 }}>{kind === "VIDEO" ? "VÍDEO" : "ANÚNCIO"}</Text> : null}
    </View>
  );
}

export type CreativeCardView = {
  name: string;
  badges: { label: string; tone: Tone; detail: string }[];
  metrics: { label: string; value: string }[];
  preview: string | null;
  objectType: string | null;
  permalink: string | null;
};

export type LayoutPlan = {
  creativeCards?: {
    columns?: 1 | 2;
    maxLines?: number;
    minWidth?: number;
  };
  narrative?: {
    placement?: "first_page" | "next_page";
    maxParagraphs?: number;
    maxChars?: number;
  };
};

function clampCardName(value: string, maxLines: number): string {
  const limit = Math.max(1, maxLines) * 28;
  return value.length <= limit ? value : `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

/** 1 criativo → cartão largo; 2 → metades; 3 → terços; 4 → 2×2. */
export function CreativeCards({ items, layout }: { items: CreativeCardView[]; layout?: LayoutPlan["creativeCards"] }) {
  if (!items.length) return null;
  const n = items.length;
  // A planned layout may force a conservative one/two-column grid. The
  // legacy heuristic remains the fallback for existing callers.
  const cols = layout?.columns ?? (n === 4 ? 2 : Math.min(n, 3));
  const gap = 8;
  const cardW = Math.max(layout?.minWidth ?? 0, (W - gap * (cols - 1)) / cols);
  const wide = n === 1;
  const horizontal = wide || cols <= 2;
  const img = wide ? 110 : horizontal ? 84 : 64;
  const maxLines = layout?.maxLines ?? 2;
  return (
    <View style={[T.cardRow, { gap, width: W }]} wrap>
      {items.map((c) => (
        <View key={c.name} style={[T.card, { width: cardW, minWidth: layout?.minWidth ?? 0, maxWidth: cardW, flexDirection: horizontal ? "row" : "column" }]} wrap>
          <Thumb src={c.preview} size={horizontal ? img : cardW - 18} kind={c.objectType} />
          {/* Em linha o texto ocupa o resto da largura; em coluna (3 cartões) `flex: 1`
              sem altura no pai encolhia o bloco a zero e sumia com nome e números. */}
          <View style={horizontal ? { flex: 1, gap: 4, minWidth: 0 } : { gap: 4 }}>
            {c.badges.map((b) => (
              <Text key={b.label} style={[T.cardBadge, { color: b.tone === "bad" ? C.danger : b.tone === "good" ? C.tealText : SEC }]}>{b.label}</Text>
            ))}
            <Text style={T.cardName}>{clampCardName(c.name, maxLines)}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 }}>
              {c.metrics.map((m) => (
                <View key={m.label}>
                  <Text style={T.cardMetricValue}>{m.value}</Text>
                  <Text style={T.cardMetricLabel}>{m.label}</Text>
                </View>
              ))}
            </View>
            {c.badges[0]?.detail && !c.metrics.some((m) => c.badges[0].detail === `${m.value} ${m.label}`) ? (
              <Text style={[T.cardMetricLabel, { color: SEC }]}>{c.badges[0].detail}</Text>
            ) : null}
            {c.permalink ? <Link src={c.permalink} style={T.cardLink}>ver post</Link> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---- gráficos -------------------------------------------------------------------------------

/** Linha de tendência: 2 pt, pontos nas extremidades, rótulo só no primeiro e no
 *  último valor, eixo que não começa em zero (a mudança é a história). */
export function LineChart({ periods, values, width = W, height = 90, format = (v: number) => v.toLocaleString("pt-BR") }: { periods: string[]; values: (number | null)[]; width?: number; height?: number; format?: (v: number) => string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const top = 14;
  const bottom = 16;
  const left = 8;
  const right = 8;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  // Folga maior embaixo: o ponto mais baixo nunca encosta na base, e o número dele
  // cabe abaixo do ponto em vez de cruzar a linha que sobe.
  const pad = (max - min) * 0.2 || Math.max(1, max * 0.05);
  const lo = min - pad * 3;
  const hi = max + pad;
  const x = (i: number) => left + ((width - left - right) * i) / Math.max(1, periods.length - 1);
  const y = (v: number) => top + (height - top - bottom) * (1 - (v - lo) / (hi - lo));
  const d = pts.map((p, k) => `${k === 0 ? "M" : "L"} ${x(p.i)} ${y(p.v)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  return (
    <Svg viewBox={`0 0 ${width} ${height}`} style={{ width, height }}>
      <Line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke={LINE} strokeWidth={1} />
      <Path d={d} stroke={TEAL.d2} strokeWidth={2} fill="none" />
      {[first, last].map((p) => {
        // O número vai para o lado oposto ao da linha: se ela chega de cima, fica
        // embaixo do ponto (antes "R$ 185,40" cruzava a linha que descia até ele).
        const neighbor = p === first ? pts[1] : pts[pts.length - 2];
        const py = y(p.v);
        const below = neighbor.v > p.v && py + 12 <= height - bottom;
        return (
          <G key={p.i}>
            <Circle cx={x(p.i)} cy={py} r={5} fill="#ffffff" />
            <Circle cx={x(p.i)} cy={py} r={3.5} fill={TEAL.d2} />
            <SvgText x={x(p.i)} y={below ? py + 12 : py - 7} textAnchor={p === first ? "start" : "end"} fill={INK} fontFamily="Inter" fontWeight={700} fontSize={7.5}>{format(p.v)}</SvgText>
          </G>
        );
      })}
      {periods.map((label, i) => (
        <SvgText key={label + i} x={x(i)} y={height - 4} textAnchor={i === 0 ? "start" : i === periods.length - 1 ? "end" : "middle"} fill={MUTED} fontFamily="Inter" fontSize={6.5}>{label}</SvgText>
      ))}
    </Svg>
  );
}

/** Colunas agrupadas numa matiz, dois tons (série com ordem: agendamento claro,
 *  venda escuro). Um eixo; valor escrito só na última semana. */
export function ColumnsChart({ periods, series, width = W, height = 100 }: { periods: string[]; series: { label: string; values: (number | null)[] }[]; width?: number; height?: number }) {
  const top = 12;
  const bottom = 16;
  const tones = [TEAL.d4, TEAL.d1];
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const groupW = width / Math.max(1, periods.length);
  const barW = Math.min(18, (groupW * 0.6) / Math.max(1, series.length));
  const inner = series.length * barW + (series.length - 1) * 2;
  const plotH = height - top - bottom;
  return (
    <View wrap={false}>
      <Svg viewBox={`0 0 ${width} ${height}`} style={{ width, height }}>
        <Line x1={0} y1={top + plotH} x2={width} y2={top + plotH} stroke={LINE} strokeWidth={1} />
        {periods.map((p, gi) => {
          const gx = gi * groupW + (groupW - inner) / 2;
          return (
            <G key={p + gi}>
              {series.map((s, si) => {
                const v = s.values[gi];
                if (v === null) return null;
                const h = Math.max(1.5, (v / max) * plotH);
                const bx = gx + si * (barW + 2);
                return (
                  <G key={s.label}>
                    <Rect x={bx} y={top + plotH - h} width={barW} height={h} fill={tones[si % tones.length]} />
                    {gi === periods.length - 1 ? (
                      <SvgText x={bx + barW / 2} y={top + plotH - h - 3} textAnchor="middle" fill={INK} fontFamily="Inter" fontWeight={700} fontSize={7}>{v.toLocaleString("pt-BR")}</SvgText>
                    ) : null}
                  </G>
                );
              })}
              <SvgText x={gi * groupW + groupW / 2} y={height - 4} textAnchor="middle" fill={MUTED} fontFamily="Inter" fontSize={6.5}>{p}</SvgText>
            </G>
          );
        })}
      </Svg>
      {series.length >= 2 ? (
        <View style={T.legendRow}>
          {series.map((s, si) => (
            <View key={s.label} style={T.legendItem}><View style={[T.legendSwatch, { backgroundColor: tones[si % tones.length] }]} /><Text style={T.legendLabel}>{s.label}</Text></View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Barras horizontais ordenadas (origem das vendas), "sem origem" em cinza no fim. */
export function RankBars({ rows, width = W }: { rows: { label: string; value: number; text: string; muted?: boolean }[]; width?: number }) {
  const labelW = 90;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const barW = width - labelW - 90;
  return (
    <View wrap={false}>
      {rows.map((r) => (
        <View key={r.label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 3 }}>
          <Text style={{ width: labelW, fontSize: 7.5, fontWeight: 600, color: r.muted ? MUTED : INK }}>{r.label}</Text>
          <View style={{ width: Math.max(2, (barW * r.value) / max), height: 10, backgroundColor: r.muted ? "#c9d1cc" : TEAL.d2, borderTopRightRadius: 2, borderBottomRightRadius: 2 }} />
          <Text style={{ fontSize: 7.5, color: INK, marginLeft: 6 }}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** Três pequenos múltiplos lado a lado, cada um com o próprio eixo — nunca eixo duplo. */
export function SmallMultiples({ charts }: { charts: { title: string; periods: string[]; values: (number | null)[]; format: (v: number) => string }[] }) {
  const cw = (W - 16 * (charts.length - 1)) / charts.length;
  return (
    <View style={{ flexDirection: "row", gap: 16 }} wrap={false}>
      {charts.map((c) => (
        <View key={c.title} style={{ width: cw }}>
          <Text style={[T.figureLabel, { marginBottom: 2 }]}>{c.title}</Text>
          <LineChart periods={c.periods} values={c.values} width={cw} height={70} format={c.format} />
        </View>
      ))}
    </View>
  );
}
