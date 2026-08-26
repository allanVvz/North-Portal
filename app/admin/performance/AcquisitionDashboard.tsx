"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import MetricSettingsMenu from "./MetricSettingsMenu";
import TrendChart, { type TrendSeriesDefinition } from "./charts/TrendChart";
import {
  acquisitionMetricAvailable, acquisitionMetricLabel, acquisitionMetricSeries,
  ratio, resolveAcquisitionMetric, summarizeAcquisition, totalWhenPresent, type NullableMetric,
} from "./acquisitionInsights";
import { metricLabel } from "./insights";
import { metricRefInverse, metricRefKind, metricRefOptions } from "./performanceLabels";
import type { PerformanceWorkspace } from "./usePerformanceWorkspace";
import { ACQUISITION_VIEW_PREFS_DEFAULT } from "@/lib/acquisitionPrefs";
import type { CustomMetric, MetricRef } from "@/lib/performancePrefs";
import type { MetaPost } from "@/lib/windsor";

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

function format(value: NullableMetric, kind: "number" | "money" | "percent" | "decimal" = "number") {
  if (value === null) return "—";
  if (kind === "money") return money.format(value);
  if (kind === "percent") return `${decimal.format(value)}%`;
  if (kind === "decimal") return decimal.format(value);
  return number.format(value);
}

function delta(current: NullableMetric, previous: NullableMetric) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function Delta({ current, previous, inverse = false }: { current: NullableMetric; previous: NullableMetric; inverse?: boolean }) {
  const value = delta(current, previous);
  if (value === null) return <span className="acq-delta neutral">Sem comparativo</span>;
  const good = inverse ? value <= 0 : value >= 0;
  return <span className={`acq-delta ${good ? "good" : "bad"}`}>{value >= 0 ? "↑" : "↓"} {decimal.format(Math.abs(value))}% vs. anterior</span>;
}

function Gauge({ label, current, previous, kind, inverse = false }: { label: string; current: NullableMetric; previous: NullableMetric; kind: "money" | "percent" | "decimal"; inverse?: boolean }) {
  const max = Math.max(current ?? 0, previous ?? 0);
  const progress = current === null || max === 0 ? 0 : Math.max(7, (current / max) * 100);
  return (
    <article className="acq-gauge-card">
      <div className="acq-gauge" style={{ "--gauge-progress": `${progress / 2}%` } as CSSProperties} aria-hidden="true">
        <div className="acq-gauge-cutout" />
      </div>
      <div className="acq-gauge-copy">
        <span>{label}</span>
        <strong>{format(current, kind)}</strong>
        <Delta current={current} previous={previous} inverse={inverse} />
      </div>
    </article>
  );
}

function Kpi({ label, value, previous, kind, hint, inverse = false, onHide }: { label: string; value: NullableMetric; previous: NullableMetric; kind?: "number" | "money" | "percent" | "decimal"; hint?: string; inverse?: boolean; onHide?: () => void }) {
  return (
    <article className="acq-kpi">
      <div className="perf-kpi-headrow">
        <span>{label}</span>
        {onHide ? <button type="button" className="perf-kpi-hide" aria-label={`Esconder ${label}`} onClick={onHide}>✕</button> : null}
      </div>
      <strong>{format(value, kind)}</strong>
      <Delta current={value} previous={previous} inverse={inverse} />
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

// Card central do funil — imagem à esquerda, etapas + par de resultado à direita
// (Parte 4); as etapas (2-3) vêm de `funnelStages`, configurável por
// template (Parte 5a).
function ConversionFunnel({
  stages, current, customMetrics, showMessageBranch, summary,
}: {
  stages: MetricRef[];
  current: MetaPost[];
  customMetrics: CustomMetric[];
  showMessageBranch: boolean;
  summary: ReturnType<typeof summarizeAcquisition>;
}) {
  const stageValues = stages.map((ref) => resolveAcquisitionMetric(current, ref, customMetrics));
  const stageLabels = stages.map((ref) => acquisitionMetricLabel(ref, customMetrics, metricLabel));
  const stageRates = stageValues.slice(1).map((value, i) => ratioLabel(value, stageValues[i]));
  const spend = totalWhenPresent(current, "custo");
  const lastValue = stageValues[stageValues.length - 1];
  const costPerLastStage = ratio(spend, lastValue);
  // Mesmo cálculo do custo por lead, para que os dois resultados sejam
  // comparáveis: o mesmo investimento dividido por cada desfecho.
  const costPerMessage = ratio(spend, summary.messages);
  return (
    <div className="acq-conversion-flow">
      <div className="acq-funnel-layout">
        <div className="acq-object-wrap">
          <Image src="/images/performance/acquisition-funnel.png" alt="Funil abstrato roxo, largo no topo e estreito na base" width={220} height={220} priority={false} />
        </div>
        <div className="acq-funnel-info">
          <div className="acq-flow-stages">
            {stageLabels.map((label, index) => <div className="acq-flow-item" key={label}>
              <div className={`acq-flow-stage ${stageValues[index] === null ? "missing" : ""}`}><span>{label}</span><strong>{format(stageValues[index])}</strong></div>
              {index < stageLabels.length - 1 ? <div className="acq-flow-arrow" aria-label={`${stageRates[index]} para a próxima etapa`}><b aria-hidden>→</b><small>{stageRates[index]}</small></div> : null}
            </div>)}
          </div>
          {/* Os dois resultados do funil, lado a lado e com o mesmo peso.
              Conversas iniciadas era uma ramificação pendurada num "↘", o que
              a lia como subproduto dos cliques; nesta operação as duas são
              a mesma coisa — alguém levantou a mão — e disputam o mesmo
              investimento, então precisam ser comparáveis na mesma linha. */}
          <div className={`acq-outcomes${showMessageBranch ? "" : " single"}`}>
            <div className="acq-outcome leads">
              <span className="acq-outcome-label">Leads</span>
              <strong className="acq-outcome-value">{format(summary.opportunities)}</strong>
              <span className="acq-outcome-cost">{format(summary.costPerLead, "money")} por lead</span>
              <span className="acq-outcome-rate">{format(summary.conversionRate, "percent")} dos cliques</span>
            </div>
            {showMessageBranch ? (
              <div className="acq-outcome conversas">
                <span className="acq-outcome-label">Conversas iniciadas</span>
                <strong className="acq-outcome-value">{format(summary.messages)}</strong>
                <span className="acq-outcome-cost">{format(costPerMessage, "money")} por conversa</span>
                <span className="acq-outcome-rate">
                  {format(summary.clickToMessageRate, "percent")} dos cliques{summary.messageClickBasis === "link" ? " no link" : ""}
                </span>
              </div>
            ) : null}
          </div>
          <div className="acq-funnel-terminal"><span>Custo por {stageLabels[stageLabels.length - 1]?.toLowerCase()}</span><strong>{format(costPerLastStage, "money")}</strong><small>investimento ÷ {stageLabels[stageLabels.length - 1]?.toLowerCase()}</small></div>
        </div>
      </div>
    </div>
  );
}

function ratioLabel(numerator: NullableMetric, denominator: NullableMetric) {
  if (numerator === null || denominator === null || denominator === 0) return "—";
  return `${decimal.format((numerator / denominator) * 100)}%`;
}

export default function AcquisitionDashboard({ workspace }: { workspace: PerformanceWorkspace }) {
  const {
    period, loading, error,
    currentPaidRows, prevPaidRows,
    activeTemplateId, activeTemplateConfig, markTemplateDirty,
    setLatestAcquisition,
    hiddenSections: allHiddenSections, toggleSectionVisibility,
  } = workspace;
  const hiddenSections = allHiddenSections.acquisition;
  const hideSection = (key: string) => toggleSectionVisibility("acquisition", key);

  const [kpiSlots, setKpiSlots] = useState<MetricRef[]>(ACQUISITION_VIEW_PREFS_DEFAULT.kpiSlots);
  const [volumeSlots, setVolumeSlots] = useState<MetricRef[]>(ACQUISITION_VIEW_PREFS_DEFAULT.volumeSlots);
  const [gaugeSlots, setGaugeSlots] = useState<MetricRef[]>(ACQUISITION_VIEW_PREFS_DEFAULT.gaugeSlots);
  const [funnelStages, setFunnelStages] = useState<MetricRef[]>(ACQUISITION_VIEW_PREFS_DEFAULT.funnelStages);
  const [showMessageBranch, setShowMessageBranch] = useState(ACQUISITION_VIEW_PREFS_DEFAULT.showMessageBranch);
  const [trendMetrics, setTrendMetrics] = useState<MetricRef[]>(ACQUISITION_VIEW_PREFS_DEFAULT.trendMetrics);
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>([]);

  const appliedTemplateRef = useRef("");
  useEffect(() => {
    if (!activeTemplateConfig || appliedTemplateRef.current === activeTemplateId) return;
    appliedTemplateRef.current = activeTemplateId;
    const acq = activeTemplateConfig.acquisition;
    setKpiSlots(acq.kpiSlots);
    setVolumeSlots(acq.volumeSlots);
    setGaugeSlots(acq.gaugeSlots);
    setFunnelStages(acq.funnelStages);
    setShowMessageBranch(acq.showMessageBranch);
    setTrendMetrics(acq.trendMetrics);
    // Aquisição não tem lista própria de métricas customizadas — reaproveita
    // o conjunto do template (agency-wide), o mesmo que o Analytics usa.
    setCustomMetrics(activeTemplateConfig.prefs.customMetrics);
  }, [activeTemplateConfig, activeTemplateId]);

  useEffect(() => {
    setLatestAcquisition({ kpiSlots, volumeSlots, gaugeSlots, funnelStages, showMessageBranch, trendMetrics });
  }, [kpiSlots, volumeSlots, gaugeSlots, funnelStages, showMessageBranch, trendMetrics, setLatestAcquisition]);

  const current = currentPaidRows;
  const prev = prevPaidRows;
  const summary = useMemo(() => summarizeAcquisition(current), [current]);
  const previousSummary = useMemo(() => summarizeAcquisition(prev), [prev]);

  const metricOptions = useMemo(() => metricRefOptions(current, customMetrics), [current, customMetrics]);
  const trend = useMemo(() => {
    const series = trendMetrics.map((metric) => acquisitionMetricSeries(current, metric, period.from, period.to, customMetrics));
    const dates = series[0] ?? [];
    return dates.map((point, dayIndex) => Object.assign({ date: point.date }, ...series.map((values, seriesIndex) => ({ [`metric${seriesIndex}`]: values[dayIndex]?.value ?? 0 }))));
  }, [current, trendMetrics, period, customMetrics]);
  const trendDefinitions = useMemo<TrendSeriesDefinition[]>(
    () => trendMetrics.map((metric, index) => ({ key: `metric${index}`, label: acquisitionMetricLabel(metric, customMetrics, metricLabel), money: metricRefKind(metric, customMetrics) === "money" })),
    [trendMetrics, customMetrics],
  );

  function toggleKpiSlot(ref: MetricRef) {
    setKpiSlots((slots) => slots.includes(ref) ? slots.filter((m) => m !== ref) : [...slots, ref]);
    markTemplateDirty();
  }
  function toggleVolumeSlot(ref: MetricRef) {
    setVolumeSlots((slots) => slots.includes(ref) ? slots.filter((m) => m !== ref) : [...slots, ref]);
    markTemplateDirty();
  }
  function toggleGaugeSlot(ref: MetricRef) {
    setGaugeSlots((slots) => slots.includes(ref) ? slots.filter((m) => m !== ref) : [...slots, ref]);
    markTemplateDirty();
  }
  function toggleFunnelStage(ref: MetricRef) {
    setFunnelStages((slots) => slots.includes(ref) ? slots.filter((m) => m !== ref) : [...slots, ref]);
    markTemplateDirty();
  }
  function toggleTrendMetric(ref: MetricRef) {
    setTrendMetrics((slots) => slots.includes(ref) ? (slots.length === 1 ? slots : slots.filter((m) => m !== ref)) : [...slots.slice(-1), ref]);
    markTemplateDirty();
  }

  return (
    <div data-testid="acquisition-dashboard">
      {error ? <div className="acq-alert" role="alert">{error}</div> : null}
      {workspace.data?.demo ? <div className="acq-demo-note">Dados demonstrativos · conecte uma conta Meta para abrir conjuntos e criativos reais.</div> : null}

      {!hiddenSections.has("kpis") ? (
        <div className="perf-section-group">
          <div className="perf-kpis-head">
            <p className="perf-kpis-title">KPIs</p>
            <MetricSettingsMenu label="KPIs de aquisição" options={metricOptions} selected={kpiSlots} multiple max={6} onChange={toggleKpiSlot} onHideSection={() => hideSection("kpis")} />
          </div>
          <section className="acq-kpi-grid" aria-label="KPIs principais">
            {kpiSlots.map((ref) => {
              const value = resolveAcquisitionMetric(current, ref, customMetrics);
              const previous = resolveAcquisitionMetric(prev, ref, customMetrics);
              return <Kpi key={ref} label={acquisitionMetricLabel(ref, customMetrics, metricLabel)} value={value} previous={previous} kind={metricRefKind(ref, customMetrics)} inverse={metricRefInverse(ref, customMetrics)} onHide={() => toggleKpiSlot(ref)} />;
            })}
            {!kpiSlots.length ? <p className="perf-empty">Nenhum KPI selecionado.</p> : null}
          </section>
        </div>
      ) : null}

      {!hiddenSections.has("funnel") ? (
        <section className="acq-conversion-panel">
          <div className="acq-section-head">
            <div><span>Conversão e intenção</span><h2>Funil de aquisição</h2></div>
            <small>Alcance → clique → resultado · leads e conversas lado a lado</small>
            <MetricSettingsMenu label="etapas do funil" options={metricOptions} selected={funnelStages} multiple max={3} onChange={toggleFunnelStage} onHideSection={() => hideSection("funnel")} />
          </div>
          <ConversionFunnel stages={funnelStages} current={current} customMetrics={customMetrics} showMessageBranch={showMessageBranch} summary={summary} />
          <label className="acq-message-toggle"><input type="checkbox" checked={showMessageBranch} onChange={(e) => { setShowMessageBranch(e.target.checked); markTemplateDirty(); }} /> Mostrar conversas iniciadas</label>

          {!hiddenSections.has("trend") ? (
            <div className="acq-funnel-trend">
              <div className="acq-section-head">
                <div><span>Evolução</span><h2>{trendDefinitions.map((d) => d.label).join(" x ") || "Tendência"}</h2></div>
                <small>Linhas independentes · mesmo período</small>
                <MetricSettingsMenu label="métricas da evolução" options={metricOptions} selected={trendMetrics} multiple max={2} onChange={toggleTrendMetric} onHideSection={() => hideSection("trend")} />
              </div>
              {loading ? <div className="acq-loading">Carregando série…</div> : <TrendChart data={trend} series={trendDefinitions} />}
            </div>
          ) : null}
        </section>
      ) : null}

      {!hiddenSections.has("volume") ? (
        <div className="perf-section-group">
          <div className="perf-kpis-head">
            <p className="perf-kpis-title">Volume</p>
            <MetricSettingsMenu label="métricas de volume" options={metricOptions} selected={volumeSlots} multiple max={4} onChange={toggleVolumeSlot} onHideSection={() => hideSection("volume")} />
          </div>
          <section className="acq-kpi-grid" aria-label="Volume de mídia">
            {volumeSlots.map((ref) => {
              const value = resolveAcquisitionMetric(current, ref, customMetrics);
              const previous = resolveAcquisitionMetric(prev, ref, customMetrics);
              return <Kpi key={ref} label={acquisitionMetricLabel(ref, customMetrics, metricLabel)} value={value} previous={previous} kind={metricRefKind(ref, customMetrics)} inverse={metricRefInverse(ref, customMetrics)} onHide={() => toggleVolumeSlot(ref)} />;
            })}
            <Kpi label="Taxa de conversão" value={summary.conversionRate} previous={previousSummary.conversionRate} kind="percent" hint="Leads ÷ cliques" />
          </section>
        </div>
      ) : null}

      {!hiddenSections.has("gauges") ? (
        <section className="acq-gauges" aria-label="Indicadores de mídia">
          <div className="acq-section-head"><div><span>Eficiência de mídia</span><h2>Custos e taxas</h2></div><small>Arco: atual em relação ao período anterior</small><MetricSettingsMenu label="métricas de eficiência" options={metricOptions} selected={gaugeSlots} multiple max={4} onChange={toggleGaugeSlot} onHideSection={() => hideSection("gauges")} /></div>
          <div className="acq-gauge-grid">
            {gaugeSlots.map((ref) => {
              const value = resolveAcquisitionMetric(current, ref, customMetrics);
              const previous = resolveAcquisitionMetric(prev, ref, customMetrics);
              const kind = metricRefKind(ref, customMetrics);
              return <Gauge key={ref} label={acquisitionMetricLabel(ref, customMetrics, metricLabel)} current={value} previous={previous} kind={kind === "number" ? "decimal" : kind} inverse={metricRefInverse(ref, customMetrics)} />;
            })}
          </div>
        </section>
      ) : null}

      {!acquisitionMetricAvailable(current, kpiSlots[0] ?? "custo", customMetrics) && !loading && !current.length ? (
        <p className="acq-table-empty">Nenhum dado pago no período com os filtros atuais.</p>
      ) : null}
    </div>
  );
}
