"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MixDonut from "./charts/MixDonut";
import PostsBarChart from "./charts/PostsBarChart";
import TrendChart, { type TrendSeriesDefinition } from "./charts/TrendChart";
import CustomMetricsPanel from "./CustomMetricsPanel";
import MetricSettingsMenu from "./MetricSettingsMenu";
import {
  DASH_METRICS, campaignMetricValue, engagementMix, metricRefAvailable, metricRefLabel,
  resolveMetricValue, topCampaigns, trendSeries,
} from "./insights";
import { metricRefKind, metricRefOptions, metricValue } from "./performanceLabels";
import type { PerformanceWorkspace } from "./usePerformanceWorkspace";
import {
  PERFORMANCE_VIEW_PREFS_DEFAULT,
  type CustomMetric, type KpiSlot, type MetricRef,
} from "@/lib/performancePrefs";
import type { MetaPost } from "@/lib/windsor";

type AmbosSource = "paid" | "organic";

function AmbosToggle({
  visible,
  cardKey,
  source,
  onChange,
}: {
  visible: boolean;
  cardKey: string;
  source: AmbosSource;
  onChange: (cardKey: string, source: AmbosSource) => void;
}) {
  if (!visible) return null;
  return (
    <div className="perf-ambos-toggle" role="group" aria-label="Fonte dos dados">
      <button type="button" className={source === "paid" ? "on" : ""} onClick={() => onChange(cardKey, "paid")}>Pago</button>
      <button type="button" className={source === "organic" ? "on" : ""} onClick={() => onChange(cardKey, "organic")}>Orgânico</button>
    </div>
  );
}

export default function PerformanceDashboard({ workspace }: { workspace: PerformanceWorkspace }) {
  const {
    error, paidConnected, period, loading, preset, sortKey, sortDir, visibleColumns,
    category,
    currentPaidRows, prevPaidRows, currentOrganicRows, prevOrganicRows, listedCurrentPaidRows,
    adsetPostRows, adPostRows,
    entitySummaries,
    entityLevel, selectedCampaignIds, selectedAdsetIds,
    selectedAdIds,
    ambosSource, setAmbosCardSource,
    activeTemplateId, activeTemplateConfig, markTemplateDirty,
    setLatestPrefs, setLatestTrendMetrics,
    hiddenSections: allHiddenSections, toggleSectionVisibility,
  } = workspace;
  const hiddenSections = allHiddenSections.analytics;
  const hideSection = (key: string) => toggleSectionVisibility("analytics", key);

  const [kpiSlots, setKpiSlots] = useState<KpiSlot[]>(PERFORMANCE_VIEW_PREFS_DEFAULT.kpiSlots);
  const [kpiMenuOpen, setKpiMenuOpen] = useState(false);
  const [trendMetrics, setTrendMetrics] = useState<MetricRef[]>([PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric]);
  const [topCampaignsMetric, setTopCampaignsMetric] = useState<MetricRef>(PERFORMANCE_VIEW_PREFS_DEFAULT.topCampaignsMetric);
  const [mixMetric, setMixMetric] = useState<[MetricRef, MetricRef, MetricRef, MetricRef]>(PERFORMANCE_VIEW_PREFS_DEFAULT.mixMetric);
  const [mixMenuOpen, setMixMenuOpen] = useState(false);
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>(PERFORMANCE_VIEW_PREFS_DEFAULT.customMetrics);
  const [customMetricsOpen, setCustomMetricsOpen] = useState(false);

  // Aplica a fatia `prefs` do template ativo ao estado local (kpiSlots/
  // trend/top-campanhas/mix/custom-metrics) sempre que o template mudar —
  // nunca ao editar localmente (senão a própria edição seria revertida).
  const appliedTemplateRef = useRef("");
  useEffect(() => {
    if (!activeTemplateConfig || appliedTemplateRef.current === activeTemplateId) return;
    appliedTemplateRef.current = activeTemplateId;
    setKpiSlots(activeTemplateConfig.prefs.kpiSlots);
    setTrendMetrics(activeTemplateConfig.trendMetrics);
    setTopCampaignsMetric(activeTemplateConfig.prefs.topCampaignsMetric);
    setMixMetric(activeTemplateConfig.prefs.mixMetric);
    setCustomMetrics(activeTemplateConfig.prefs.customMetrics);
  }, [activeTemplateConfig, activeTemplateId]);

  // Reporta a config local mais recente ao workspace para que salvar um
  // template (que pode ser disparado a partir de qualquer uma das 2 telas)
  // sempre inclua a fatia Analytics atual.
  useEffect(() => {
    setLatestPrefs({ visibleColumns, sortKey, sortDir, defaultPeriod: preset, kpiSlots, trendMetric: trendMetrics[0], topCampaignsMetric, mixMetric, customMetrics });
    setLatestTrendMetrics(trendMetrics);
  }, [visibleColumns, sortKey, sortDir, preset, kpiSlots, trendMetrics, topCampaignsMetric, mixMetric, customMetrics, setLatestPrefs, setLatestTrendMetrics]);

  const rowsFor = (cardKey: string): { current: MetaPost[]; prev: MetaPost[] } => {
    if (category === "organico") return { current: currentOrganicRows, prev: prevOrganicRows };
    if (category === "ambos") {
      const source = ambosSource[cardKey] ?? "paid";
      return source === "paid" ? { current: currentPaidRows, prev: prevPaidRows } : { current: currentOrganicRows, prev: prevOrganicRows };
    }
    return { current: currentPaidRows, prev: prevPaidRows };
  };

  const allCurrentRows = useMemo(() => [...currentPaidRows, ...currentOrganicRows], [currentPaidRows, currentOrganicRows]);
  const metricPillOptions = useMemo(() => metricRefOptions(allCurrentRows, customMetrics), [allCurrentRows, customMetrics]);
  const paidMetricPillOptions = useMemo(() => metricRefOptions(currentPaidRows, customMetrics), [currentPaidRows, customMetrics]);

  useEffect(() => {
    if (metricPillOptions.length && !trendMetrics.some((m) => metricPillOptions.some((o) => o.ref === m))) setTrendMetrics([metricPillOptions[0].ref]);
  }, [metricPillOptions, trendMetrics]);
  useEffect(() => {
    if (paidMetricPillOptions.length && !paidMetricPillOptions.some((m) => m.ref === topCampaignsMetric)) setTopCampaignsMetric(paidMetricPillOptions[0].ref);
  }, [paidMetricPillOptions, topCampaignsMetric]);

  const trendRows = rowsFor("trend");
  const mixRows = rowsFor("mix");

  const comparisonIds = entityLevel === "campaign" ? selectedCampaignIds : entityLevel === "adset" ? selectedAdsetIds : selectedAdIds;
  const comparisonGroups = useMemo(() => {
    const source = entityLevel === "campaign" ? listedCurrentPaidRows : entityLevel === "adset" ? adsetPostRows : adPostRows;
    return comparisonIds.map((id) => {
      const rows = source.filter((post) => {
        if (entityLevel === "campaign") return post.campaignId && `${post.accountId}:${post.campaignId}` === id;
        if (entityLevel === "adset") return post.adsetId === id;
        return post.adId === id;
      });
      const first = rows[0];
      const label = entityLevel === "campaign" ? first?.campaignName : entityLevel === "adset" ? first?.adsetName : first?.adName;
      return { id, label: label || `${entityLevel === "campaign" ? "Campanha" : entityLevel === "adset" ? "Conjunto" : "Criativo"} ${id.slice(0, 6)}`, rows };
    });
  }, [entityLevel, comparisonIds, listedCurrentPaidRows, adsetPostRows, adPostRows]);
  const activeEntitySelection = comparisonIds;
  const activeEntityLabel = entityLevel === "campaign" ? "campanha" : entityLevel === "adset" ? "conjunto" : "criativo";
  const hasSelectionContext = activeEntitySelection.length > 0;
  const selectionCount = activeEntitySelection.length;
  // A seleção é a fonte de verdade da comparação. Mesmo uma entidade sem
  // entrega em um dos dias mantém sua série (zerada), evitando o gráfico
  // voltar silenciosamente para a comparação de métricas.
  const isEntityComparison = comparisonIds.length > 1;
  const trendDefinitions = useMemo<TrendSeriesDefinition[]>(() => isEntityComparison
    ? comparisonGroups.map((group, index) => ({ key: `entity${index}`, label: group.label, money: metricRefKind(trendMetrics[0], customMetrics) === "money", dash: index % 2 ? "7 4" : undefined }))
    : trendMetrics.map((metric, index) => ({ key: `metric${index}`, label: metricRefLabel(metric, customMetrics), money: metricRefKind(metric, customMetrics) === "money" })),
  [isEntityComparison, comparisonGroups, trendMetrics, customMetrics]);
  const trend = useMemo(() => {
    const series = isEntityComparison
      ? comparisonGroups.map((group) => trendSeries(group.rows, trendMetrics[0], period, customMetrics))
      : trendMetrics.map((metric) => trendSeries(trendRows.current, metric, period, customMetrics));
    const dates = series[0] ?? [];
    return dates.map((point, dayIndex) => Object.assign({ date: point.date }, ...series.map((values, seriesIndex) => ({ [`${isEntityComparison ? "entity" : "metric"}${seriesIndex}`]: values[dayIndex]?.value ?? 0 }))));
  }, [isEntityComparison, comparisonGroups, trendRows.current, trendMetrics, period, customMetrics]);

  const campaignTop = useMemo(() => topCampaigns(currentPaidRows, topCampaignsMetric, 8, customMetrics), [currentPaidRows, topCampaignsMetric, customMetrics]);
  const mix = useMemo(() => engagementMix(mixRows.current, mixMetric, customMetrics), [mixRows.current, mixMetric, customMetrics]);
  const topRows = useMemo(() => entityLevel === "campaign"
    ? campaignTop.map((row) => ({ key: row.key, caption: row.caption, platform: row.platform, value: campaignMetricValue(row, topCampaignsMetric, customMetrics) }))
    : entitySummaries.slice().sort((a, b) => campaignMetricValue(b, topCampaignsMetric, customMetrics) - campaignMetricValue(a, topCampaignsMetric, customMetrics)).slice(0, 8).map((row) => ({ key: row.key, caption: row.name, platform: row.platform, value: campaignMetricValue(row, topCampaignsMetric, customMetrics) })),
  [entityLevel, campaignTop, entitySummaries, topCampaignsMetric, customMetrics]);

  function isKpiActive(ref: MetricRef): boolean {
    return kpiSlots.some((s) => s.metric === ref && s.visible);
  }
  function toggleKpiMetric(ref: MetricRef) {
    setKpiSlots((slots) => {
      const idx = slots.findIndex((s) => s.metric === ref);
      return idx === -1 ? [...slots, { visible: true, metric: ref }] : slots.map((s, i) => (i === idx ? { ...s, visible: !s.visible } : s));
    });
    markTemplateDirty();
  }
  function pickTrendMetric(ref: MetricRef) {
    setTrendMetrics((current) => current.includes(ref) ? (current.length === 1 ? current : current.filter((metric) => metric !== ref)) : [...current.slice(-1), ref]);
    markTemplateDirty();
  }
  function pickSingleTrendMetric(ref: MetricRef) {
    setTrendMetrics([ref]);
    markTemplateDirty();
  }
  function pickTopCampaignsMetric(ref: MetricRef) { setTopCampaignsMetric(ref); markTemplateDirty(); }
  function pickMixMetric(index: 0 | 1 | 2 | 3, ref: MetricRef) {
    setMixMetric((current) => {
      const next = [...current] as [MetricRef, MetricRef, MetricRef, MetricRef];
      next[index] = ref;
      return next;
    });
    markTemplateDirty();
  }
  function saveCustomMetric(newMetric: CustomMetric) {
    setCustomMetrics((current) => [...current, newMetric]);
    markTemplateDirty();
  }
  function deleteCustomMetric(id: string) {
    const ref: MetricRef = `custom:${id}`;
    setCustomMetrics((current) => current.filter((m) => m.id !== id));
    setKpiSlots((slots) => slots.filter((s) => s.metric !== ref));
    if (trendMetrics.includes(ref)) setTrendMetrics((current) => current.filter((m) => m !== ref).length ? current.filter((m) => m !== ref) : [PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric]);
    if (topCampaignsMetric === ref) setTopCampaignsMetric(PERFORMANCE_VIEW_PREFS_DEFAULT.topCampaignsMetric);
    if (mixMetric.includes(ref)) setMixMetric((current) => current.map((m, i) => (m === ref ? PERFORMANCE_VIEW_PREFS_DEFAULT.mixMetric[i] : m)) as [MetricRef, MetricRef, MetricRef, MetricRef]);
    markTemplateDirty();
  }

  return (
    <>
      {error ? <p className="admin-error">{error}</p> : null}
      {!loading && !error && !paidConnected ? <p className="admin-error">Conecte uma conta Meta Ads para carregar dados pagos reais.</p> : null}

      {!hiddenSections.has("kpis") ? (
        <>
          <div className="perf-kpis-head">
            <p className="perf-kpis-title">KPIs</p>
            <div className="perf-card-controls">
              <div className="perf-columns-menu">
                <button className="perf-settings-trigger icon-only" aria-label="Configurar KPIs" title="Configurar KPIs" aria-expanded={kpiMenuOpen} onClick={() => setKpiMenuOpen((v) => !v)}><svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 13a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0-.1 1 7.6 7.6 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z" /></svg></button>
                {kpiMenuOpen ? (
                  <div className="perf-columns-dropdown">
                    <div className="perf-settings-menu-head"><strong>KPIs visíveis</strong><small>Escolha os indicadores do resumo</small></div>
                    {DASH_METRICS.map((m) => (
                      <label key={m.key} className="perf-columns-item">
                        <input type="checkbox" checked={isKpiActive(m.key)} onChange={() => toggleKpiMetric(m.key)} />
                        {m.label}
                      </label>
                    ))}
                    {customMetrics.length ? <hr className="perf-columns-sep" /> : null}
                    {customMetrics.map((m) => (
                      <label key={m.id} className="perf-columns-item">
                        <input type="checkbox" checked={isKpiActive(`custom:${m.id}`)} onChange={() => toggleKpiMetric(`custom:${m.id}`)} />
                        {m.label}
                      </label>
                    ))}
                    <button className="perf-settings-create" onClick={() => { setKpiMenuOpen(false); setCustomMetricsOpen(true); }}>+ Criar métrica personalizada</button>
                    <button className="admin-btn ghost small perf-columns-close" onClick={() => setKpiMenuOpen(false)}>Fechar</button>
                  </div>
                ) : null}
              </div>
              <button type="button" className="perf-settings-trigger icon-only perf-section-hide" aria-label="Esconder KPIs" title="Esconder KPIs" onClick={() => hideSection("kpis")}>
                <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.6 6.7C4.5 8.1 3 10 2 12c1.8 3.6 5.5 7 10 7 1.7 0 3.3-.4 4.7-1.1M9.9 5.2A10.6 10.6 0 0 1 12 5c4.5 0 8.2 3.4 10 7-.6 1.2-1.4 2.4-2.4 3.4" /></svg>
              </button>
            </div>
          </div>

          <div className="perf-kpis">
            {kpiSlots.filter((s) => s.visible).map((slot, idx) => {
              const cardKey = `kpi:${slot.metric}`;
              const rows = rowsFor(cardKey);
              const available = metricRefAvailable(rows.current, slot.metric, customMetrics);
              const value = resolveMetricValue(rows.current, slot.metric, customMetrics);
              const before = resolveMetricValue(rows.prev, slot.metric, customMetrics);
              const delta = before > 0 ? Math.round(((value - before) / before) * 100) : null;
              return (
                <div className="perf-kpi" key={`${slot.metric}-${idx}`}>
                  <div className="perf-kpi-headrow">
                    <span className="perf-kpi-label">{metricRefLabel(slot.metric, customMetrics)}</span>
                    <button type="button" className="perf-kpi-hide" aria-label={`Esconder KPI ${metricRefLabel(slot.metric, customMetrics)}`} onClick={() => toggleKpiMetric(slot.metric)}>✕</button>
                  </div>
                  <strong className="perf-kpi-value">
                    {available ? metricValue(value, metricRefKind(slot.metric, customMetrics), rows.current[0]?.currency) : "—"}
                  </strong>
                  {available && delta !== null ? (
                    <span className={`perf-kpi-delta ${delta >= 0 ? "up" : "down"}`}>
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs período anterior
                    </span>
                  ) : (
                    <span className="perf-kpi-delta muted">— sem comparação disponível</span>
                  )}
                  <AmbosToggle visible={category === "ambos"} cardKey={cardKey} source={ambosSource[cardKey] ?? "paid"} onChange={setAmbosCardSource} />
                </div>
              );
            })}
            {kpiSlots.every((s) => !s.visible) ? <p className="perf-empty">Nenhum KPI selecionado — use a engrenagem para escolher.</p> : null}
          </div>
        </>
      ) : null}

      {!hiddenSections.has("trend") ? (
        <div className="perf-card perf-trend">
          <div className="perf-card-head">
            <div><h3>Tendência diária</h3><p className="perf-card-sub">{isEntityComparison ? `Comparando ${comparisonGroups.length} ${activeEntityLabel}s pela métrica ${metricRefLabel(trendMetrics[0], customMetrics)}.` : "Compare até duas métricas. Todos os filtros e seleções são aplicados às séries."}</p></div>
            <MetricSettingsMenu label="métricas da tendência" options={metricPillOptions} selected={isEntityComparison ? [trendMetrics[0]] : trendMetrics} multiple={!isEntityComparison} max={2} onChange={isEntityComparison ? pickSingleTrendMetric : pickTrendMetric} onHideSection={() => hideSection("trend")} />
          </div>
          <AmbosToggle visible={category === "ambos"} cardKey="trend" source={ambosSource.trend ?? "paid"} onChange={setAmbosCardSource} />
          <TrendChart data={trend} series={trendDefinitions} />
        </div>
      ) : null}

      <div className="perf-two-up">
        {!hiddenSections.has("topCampaigns") ? (
          <div className="perf-card">
            <div className="perf-card-head">
              <div><h3>Top {entityLevel === "campaign" ? "campanhas" : entityLevel === "adset" ? "conjuntos" : "criativos"} · {metricRefLabel(topCampaignsMetric, customMetrics)}</h3>{category !== "ads" ? <p className="perf-card-sub">A hierarquia de anúncios continua sempre em dados pagos.</p> : null}</div>
              <MetricSettingsMenu label="métrica do ranking" options={paidMetricPillOptions} selected={[topCampaignsMetric]} onChange={pickTopCampaignsMetric} onHideSection={() => hideSection("topCampaigns")} />
            </div>
            {topRows.length ? <PostsBarChart posts={topRows} label={metricRefLabel(topCampaignsMetric, customMetrics)} formatValue={(value) => metricValue(value, metricRefKind(topCampaignsMetric, customMetrics), currentPaidRows[0]?.currency)} /> : <p className="perf-empty">Sem itens com essa métrica no período.</p>}
          </div>
        ) : null}
        {!hiddenSections.has("mix") ? (
          <div className="perf-card">
            <div className="perf-card-head">
              <h3>Engajamento dos anúncios</h3>
              <div className="perf-card-controls">
                <div className="perf-columns-menu">
                  <button className="perf-settings-trigger icon-only" aria-label="Configurar métricas de engajamento" title="Configurar métricas" aria-expanded={mixMenuOpen} onClick={() => setMixMenuOpen((v) => !v)}><svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 13a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0-.1 1 7.6 7.6 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z" /></svg></button>
                  {mixMenuOpen ? (
                    <div className="perf-columns-dropdown perf-mix-dropdown">
                      {([0, 1, 2, 3] as const).map((i) => (
                        <label key={i} className="perf-mix-slot">
                          <span>Fatia {i + 1}</span>
                          <select value={mixMetric[i]} onChange={(e) => pickMixMetric(i, e.target.value as MetricRef)}>
                            {DASH_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                            {customMetrics.map((m) => <option key={m.id} value={`custom:${m.id}`}>{m.label}</option>)}
                          </select>
                        </label>
                      ))}
                      <button className="admin-btn ghost small perf-columns-close" onClick={() => setMixMenuOpen(false)}>Fechar</button>
                    </div>
                  ) : null}
                </div>
                <button type="button" className="perf-settings-trigger icon-only perf-section-hide" aria-label="Esconder engajamento" title="Esconder" onClick={() => hideSection("mix")}>
                  <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.6 6.7C4.5 8.1 3 10 2 12c1.8 3.6 5.5 7 10 7 1.7 0 3.3-.4 4.7-1.1M9.9 5.2A10.6 10.6 0 0 1 12 5c4.5 0 8.2 3.4 10 7-.6 1.2-1.4 2.4-2.4 3.4" /></svg>
                </button>
              </div>
            </div>
            <AmbosToggle visible={category === "ambos"} cardKey="mix" source={ambosSource.mix ?? "paid"} onChange={setAmbosCardSource} />
            {mix.length ? <MixDonut slices={mix} /> : <p className="perf-empty">A Meta não retornou interações no período.</p>}
          </div>
        ) : null}
      </div>

      <CustomMetricsPanel
        open={customMetricsOpen}
        onClose={() => setCustomMetricsOpen(false)}
        customMetrics={customMetrics}
        onSave={saveCustomMetric}
        onDelete={deleteCustomMetric}
      />
    </>
  );
}
