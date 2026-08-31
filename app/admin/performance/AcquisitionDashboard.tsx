"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import MetricSettingsMenu from "./MetricSettingsMenu";
import TrendChart, { type TrendSeriesDefinition } from "./charts/TrendChart";
import {
  acquisitionDelta, acquisitionMetricAvailable, acquisitionMetricLabel, acquisitionMetricSeries,
  acquisitionRateLabel, formatAcquisitionValue as format, ratio, resolveAcquisitionMetric,
  summarizeAcquisition, totalWhenPresent, type NullableMetric,
} from "./acquisitionInsights";
import { isNotIntegrated, metricLabel } from "./insights";
import { metricRefInverse, metricRefKind, metricRefOptions } from "./performanceLabels";
import { CHART_W, funnelBandLayout, funnelChartHeight, funnelStageCount } from "@/lib/reports/funnelGeometry";
import type { PerformanceWorkspace } from "./usePerformanceWorkspace";
import { ACQUISITION_SECTION_KEYS, ACQUISITION_VIEW_PREFS_DEFAULT, type AcquisitionSectionKey } from "@/lib/acquisitionPrefs";
import type { CustomMetric, MetricRef } from "@/lib/performancePrefs";
import type { MetaPost } from "@/lib/windsor";

const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function Delta({ current, previous, inverse = false }: { current: NullableMetric; previous: NullableMetric; inverse?: boolean }) {
  const value = acquisitionDelta(current, previous);
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

function Kpi({ label, value, previous, kind, hint, inverse = false, onHide, notIntegrated = false }: { label: string; value: NullableMetric; previous: NullableMetric; kind?: "number" | "money" | "percent" | "decimal"; hint?: string; inverse?: boolean; onHide?: () => void; notIntegrated?: boolean }) {
  return (
    <article className={`acq-kpi${notIntegrated ? " is-gap" : ""}`}>
      <div className="perf-kpi-headrow">
        <span>{label}</span>
        {onHide ? <button type="button" className="perf-kpi-hide" aria-label={`Esconder ${label}`} onClick={onHide}>✕</button> : null}
      </div>
      <strong>{format(value, kind)}</strong>
      {/* "0 neste período" e "esta integração não existe" são coisas diferentes.
          Um "—" mudo faz procurar um filtro errado que não está lá. */}
      {notIntegrated
        ? <span className="acq-delta gap">Sem integração</span>
        : <Delta current={value} previous={previous} inverse={inverse} />}
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

// Card central do funil — imagem à esquerda, etapas + par de resultado à direita
// (Parte 4); as etapas (2-3) vêm de `funnelStages`, configurável por
// template (Parte 5a).
function ConversionFunnel({
  stages, current, customMetrics,
}: {
  stages: MetricRef[];
  current: MetaPost[];
  customMetrics: CustomMetric[];
}) {
  const allValues = stages.map((ref) => resolveAcquisitionMetric(current, ref, customMetrics));
  // Etapa de cauda sem dado (ex.: "Seguidores" antes da ingestão) sai do funil.
  const keep = funnelStageCount(allValues);
  const stageValues = allValues.slice(0, keep);
  const stageLabels = stages.slice(0, keep).map((ref) => acquisitionMetricLabel(ref, customMetrics, metricLabel));
  const stageRates = stageValues.slice(1).map((value, i) => acquisitionRateLabel(value, stageValues[i]));
  const spend = totalWhenPresent(current, "custo");
  return (
    <div className="acq-conversion-flow">
      <div className="acq-funnel-layout">
        <FunnelChart labels={stageLabels} values={stageValues} rates={stageRates} />
        <div className="acq-funnel-info">
          {/* O desfecho é a ÚLTIMA ETAPA DO FUNIL, e ela vem do template.
              Antes eram dois cards fixos (Leads | Conversas) e um rodapé de
              total: em 4 dos 6 clientes de produção `leads` e `compras` são
              zero em 30 dias, então dois terços da área ficavam vazios para
              sempre. Agora cada template declara o desfecho que a operação dele
              persegue — conversas, compras, ou o resultado por objetivo — e a
              tela mostra um número só, com o custo e a taxa de conversão da
              etapa anterior. Nenhum desfecho aparece onde não se aplica. */}
          <ResultPanel
            label={stageLabels[stageLabels.length - 1] ?? "Resultado"}
            value={stageValues[stageValues.length - 1] ?? null}
            previousStage={stageValues[stageValues.length - 2] ?? null}
            previousLabel={stageLabels[stageLabels.length - 2] ?? ""}
            spend={spend}
          />
        </div>
      </div>
    </div>
  );
}

// Fecho do funil: um desfecho, o que ele custou, e quanto da etapa anterior
// chegou até aqui. Sem card por tipo de desfecho — ver o comentário na chamada.
function ResultPanel({
  label, value, previousStage, previousLabel, spend,
}: {
  label: string; value: NullableMetric; previousStage: NullableMetric;
  previousLabel: string; spend: NullableMetric;
}) {
  const costPer = ratio(spend, value);
  const rate = ratio(value, previousStage, 100);
  return (
    <div className="acq-result">
      <div className="acq-result-main">
        <span className="acq-result-label">{label}</span>
        <strong className="acq-result-value">{format(value)}</strong>
        {rate !== null && previousLabel ? (
          <span className="acq-result-rate">{format(rate, "percent")} de {previousLabel.toLowerCase()}</span>
        ) : null}
      </div>
      <dl className="acq-result-side">
        <div>
          {/* Rótulo fixo em vez de "custo por {label}": o desfecho já está
              nomeado logo acima, e concordar o plural do rótulo de cada métrica
              daria "custo por conversas"/"custo por compras". */}
          <dt>Custo por resultado</dt>
          <dd>{format(costPer, "money")}</dd>
        </div>
        <div>
          <dt>Investimento</dt>
          <dd>{format(spend, "money")}</dd>
        </div>
      </dl>
    </div>
  );
}

// Funil desenhado a partir dos próprios números, não uma ilustração ao lado
// deles. Substituiu um PNG de cone azul 3D: era decorativo (a forma não dizia
// nada sobre os dados), estava recortado no container e usava roxo/azul, fora
// da paleta da marca.
//
// A largura de cada faixa é proporcional ao valor da etapa em relação à
// primeira, então o estrangulamento do funil é o dado — se 8.000 de alcance
// viram 200 cliques, a faixa afunila de verdade. Etapa sem dado vira uma faixa
// tracejada de largura mínima, para não fingir um volume que não existe.
// Geometria: o funil ocupa a faixa esquerda e os números vivem FORA dele,
// ligados por linha guia. Foi a única forma de manter a proporção honesta e
// legível ao mesmo tempo — as razões reais são extremas (9.000 de alcance para
// 240 cliques é 2,65%), então com o texto dentro da faixa o rótulo
// "CLIQUES (TODOS)" ficava cortado numa faixa de 36px. Inflar a largura mínima
// até o texto caber resolveria a legibilidade mentindo sobre o dado.
//
// A escala LOGARÍTMICA das larguras + todo o layout por faixa moram em
// `lib/reports/funnelGeometry.ts` — a MESMA geometria desenha o funil do PDF da
// automação. Não recalcular aqui.
function FunnelChart({ labels, values, rates }: { labels: string[]; values: NullableMetric[]; rates: string[] }) {
  const bands = funnelBandLayout(values);
  const height = funnelChartHeight(labels.length);

  return (
    <div className="acq-funnel-chart">
      <svg viewBox={`0 0 ${CHART_W} ${height}`} role="img" width="100%" height={height}
        aria-label={`Funil: ${labels.map((label, i) => `${label} ${format(values[i])}`).join(", ")}`}>
        <defs>
          <linearGradient id="acqFunnelBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--a-teal)" />
            <stop offset="100%" stopColor="var(--a-teal-text)" />
          </linearGradient>
        </defs>
        {labels.map((label, index) => {
          const band = bands[index];
          return (
            <g key={label} className={`acq-band${band.missing ? " missing" : ""}`} style={{ animationDelay: `${index * 90}ms` }}>
              <path d={band.trapezoid}
                fill={band.missing ? "var(--a-surface2)" : "url(#acqFunnelBand)"}
                stroke={band.missing ? "var(--a-border-strong)" : "none"}
                strokeDasharray={band.missing ? "3 3" : undefined}
                opacity={band.opacity} />
              {/* Linha guia: sai da borda real da faixa, então ela encurta
                  conforme o funil afunila e o olho segue o estrangulamento. */}
              <path className="acq-band-leader" d={band.leader} />
              <circle className="acq-band-dot" cx={band.dot.cx} cy={band.dot.cy} r="2" />
              <text x={band.labelAt.x} y={band.labelAt.y} className="acq-band-label">{label.toUpperCase()}</text>
              <text x={band.valueAt.x} y={band.valueAt.y} className="acq-band-value">{format(values[index])}</text>
              {band.rateAt ? (
                <text x={band.rateAt.x} y={band.rateAt.y} className="acq-band-rate">{rates[index]}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
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
  // Esconder/mostrar seção é config do template (o PDF da automação respeita) —
  // por isso marca o template como sujo, igual às trocas de métrica.
  const hideSection = (key: string) => { toggleSectionVisibility("acquisition", key); markTemplateDirty(); };

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
    setLatestAcquisition({
      kpiSlots, volumeSlots, gaugeSlots, funnelStages, showMessageBranch, trendMetrics,
      hiddenSections: ([...hiddenSections] as AcquisitionSectionKey[]).filter((k) => ACQUISITION_SECTION_KEYS.includes(k)),
    });
  }, [kpiSlots, volumeSlots, gaugeSlots, funnelStages, showMessageBranch, trendMetrics, hiddenSections, setLatestAcquisition]);

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
              return <Kpi key={ref} label={acquisitionMetricLabel(ref, customMetrics, metricLabel)} value={value} previous={previous} kind={metricRefKind(ref, customMetrics)} inverse={metricRefInverse(ref, customMetrics)} notIntegrated={isNotIntegrated(ref, customMetrics)} onHide={() => toggleKpiSlot(ref)} />;
            })}
            {!kpiSlots.length ? <p className="perf-empty">Nenhum KPI selecionado.</p> : null}
          </section>
        </div>
      ) : null}

      {!hiddenSections.has("funnel") ? (
        <section className="acq-conversion-panel">
          <div className="acq-section-head">
            <div><span>Conversão e intenção</span><h2>Funil de aquisição</h2></div>
            <MetricSettingsMenu label="etapas do funil" options={metricOptions} selected={funnelStages} multiple max={3} onChange={toggleFunnelStage} onHideSection={() => hideSection("funnel")} />
          </div>
          {/* O ramo de conversas deixou de ter checkbox próprio: ele é regra de
              template (a fatia `acquisition` de cada builtin decide) e o desfecho
              já depende do resultado esperado da campanha — "Por resultado"
              desliga porque `resultado` já absorve a conversa. Um toggle manual
              ao lado disso dava ao operador uma terceira fonte de verdade. */}
          <ConversionFunnel stages={funnelStages} current={current} customMetrics={customMetrics} />

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
