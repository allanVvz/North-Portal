"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MixDonut from "./charts/MixDonut";
import PostsBarChart from "./charts/PostsBarChart";
import TrendChart from "./charts/TrendChart";
import CustomMetricsPanel from "./CustomMetricsPanel";
import DateRangeField from "../DateRangeField";
import PerformanceFilterBar, { type PerfActiveFilter, type PerfCategory } from "./PerformanceFilterBar";
import {
  DASH_METRICS, adSummaries, campaignMetricValue, campaignSummaries, engagementMix, filterPosts, fmtCompact,
  hasMetric, inPeriod, metricRefAvailable, metricRefLabel, previousPeriod, resolveMetricValue, sortCampaigns,
  topCampaigns, trendSeries,
  type AdSummary, type CampaignSummary, type Period,
} from "./insights";
import {
  CAMPAIGN_METRIC_COLUMNS, PERFORMANCE_VIEW_PREFS_DEFAULT, isCustomMetricRef,
  type CustomMetric, type KpiSlot, type MetricRef, type PeriodPreset, type PerformanceViewPrefs, type SortDir,
} from "@/lib/performancePrefs";
import type { MetaPlatform, MetaPost, MetaPostMetricKey, WindsorDatasource } from "@/lib/windsor";

type ClientLite = { slug: string; name: string };
type InsightsResponse = {
  demo: boolean;
  stale: boolean;
  error?: string;
  posts: MetaPost[];
  datasources: Partial<Record<WindsorDatasource | "meta_ads", boolean>>;
  fetchedAt: string | null;
};
type AdRowsState = { loading: boolean; error: string; ads: AdSummary[] };
type AmbosSource = "paid" | "organic";

const PLATFORM_LABEL: Record<MetaPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  audience_network: "Audience Network",
  unknown: "Outras redes",
};

const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_LEADS: "Leads",
  OUTCOME_SALES: "Vendas",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_APP_PROMOTION: "Aplicativo",
};

// Ratio metrics render with a different unit than the plain-count default.
const COLUMN_KIND: Partial<Record<MetaPostMetricKey, "money" | "percent" | "decimal">> = {
  frequencia: "decimal",
  ctr: "percent",
  cpc: "money",
  cpm: "money",
  custo: "money",
};

const PAGE_SIZE = 25;
const DATE_PRESETS = [7, 30, 90];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presetPeriod(days: PeriodPreset): Period {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(today) };
}

function platformTone(platform: MetaPlatform): string {
  if (platform === "instagram") return "t-tone-purple";
  if (platform === "facebook") return "t-tone-blue";
  return "t-tone-green";
}

function metricValue(value: number | undefined, kind: "number" | "money" | "percent" | "decimal" = "number", currency = "BRL") {
  if (value === undefined) return "—";
  if (kind === "percent") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (kind === "decimal") return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === "money") {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `R$ ${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;
    }
  }
  return fmtCompact(value);
}

function csvCell(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function metricRefOptions(posts: MetaPost[], customMetrics: CustomMetric[]): { ref: MetricRef; label: string }[] {
  const built = DASH_METRICS.filter((m) => hasMetric(posts, m.key)).map((m) => ({ ref: m.key as MetricRef, label: m.label }));
  const customs = customMetrics
    .filter((m) => metricRefAvailable(posts, `custom:${m.id}`, customMetrics))
    .map((m) => ({ ref: `custom:${m.id}` as MetricRef, label: m.label }));
  return [...built, ...customs];
}

export default function PerformanceDashboard({ clients, canEdit }: { clients: ClientLite[]; canEdit: boolean }) {
  const [preset, setPreset] = useState<PeriodPreset>(PERFORMANCE_VIEW_PREFS_DEFAULT.defaultPeriod);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filters, setFilters] = useState<PerfActiveFilter[]>([]);
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [sortKey, setSortKey] = useState<MetaPostMetricKey>(PERFORMANCE_VIEW_PREFS_DEFAULT.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(PERFORMANCE_VIEW_PREFS_DEFAULT.sortDir);
  const [visibleColumns, setVisibleColumns] = useState<MetaPostMetricKey[]>(PERFORMANCE_VIEW_PREFS_DEFAULT.visibleColumns);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adRows, setAdRows] = useState<Record<string, AdRowsState>>({});

  const [kpiSlots, setKpiSlots] = useState<KpiSlot[]>(PERFORMANCE_VIEW_PREFS_DEFAULT.kpiSlots);
  const [kpiMenuOpen, setKpiMenuOpen] = useState(false);
  const [trendMetric, setTrendMetric] = useState<MetricRef>(PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric);
  const [topCampaignsMetric, setTopCampaignsMetric] = useState<MetricRef>(PERFORMANCE_VIEW_PREFS_DEFAULT.topCampaignsMetric);
  const [mixMetric, setMixMetric] = useState<[MetricRef, MetricRef, MetricRef, MetricRef]>(PERFORMANCE_VIEW_PREFS_DEFAULT.mixMetric);
  const [mixMenuOpen, setMixMenuOpen] = useState(false);
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>(PERFORMANCE_VIEW_PREFS_DEFAULT.customMetrics);
  const [customMetricsOpen, setCustomMetricsOpen] = useState(false);
  // "Ambos" per-card Pago/Orgânico toggle — session-only (not persisted),
  // keyed by a small card id ("trend"/"mix"/"kpi:<metric>"). Missing entry
  // defaults to "paid" — every card starts on Pago when Ambos is selected.
  const [ambosSource, setAmbosSource] = useState<Record<string, AmbosSource>>({});

  const prefsAppliedRef = useRef(false);
  const pendingPrefsPatchRef = useRef<Partial<PerformanceViewPrefs>>({});
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const customRangeValid = Boolean(customFrom && customTo && customFrom <= customTo);
  const period = useMemo(
    () => (customRangeValid ? { from: customFrom, to: customTo } : presetPeriod(preset)),
    [customRangeValid, customFrom, customTo, preset],
  );
  const prevPeriodRange = useMemo(() => previousPeriod(period), [period]);

  const clientFilterValue = useMemo(() => filters.find((f) => f.attr === "cliente")?.value ?? "", [filters]);
  const category = useMemo<PerfCategory>(() => (filters.find((f) => f.attr === "categoria")?.value as PerfCategory) ?? "ads", [filters]);
  const platformFilterValue = useMemo(() => (filters.find((f) => f.attr === "rede")?.value as MetaPlatform | undefined) ?? "", [filters]);

  // Shared prefs (site_settings, gerente-editable) — applied once on load so
  // a later refetch (e.g. after a gerente elsewhere changes them) doesn't
  // fight the user's in-session choices.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/performance/prefs", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as PerformanceViewPrefs;
        if (prefsAppliedRef.current) return;
        prefsAppliedRef.current = true;
        setSortKey(body.sortKey);
        setSortDir(body.sortDir);
        setVisibleColumns(body.visibleColumns);
        setPreset(body.defaultPeriod);
        setKpiSlots(body.kpiSlots);
        setTrendMetric(body.trendMetric);
        setTopCampaignsMetric(body.topCampaignsMetric);
        setMixMetric(body.mixMetric);
        setCustomMetrics(body.customMetrics);
      } catch {
        // Shared prefs are an enhancement — defaults already rendered.
      }
    })();
  }, []);

  const persistPrefs = useCallback((patch: Partial<PerformanceViewPrefs>) => {
    if (!canEdit) return;
    pendingPrefsPatchRef.current = { ...pendingPrefsPatchRef.current, ...patch };
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const toSend = pendingPrefsPatchRef.current;
      pendingPrefsPatchRef.current = {};
      void fetch("/api/admin/performance/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSend),
      }).catch(() => {});
    }, 600);
  }, [canEdit]);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from: prevPeriodRange.from, to: period.to });
      if (clientFilterValue) params.set("client", clientFilterValue);
      if (refresh) params.set("refresh", "1");
      const res = await fetch(`/api/admin/performance/insights?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "");
      setData(body);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Não foi possível carregar os dados.");
    }
    setLoading(false);
  }, [prevPeriodRange.from, period.to, clientFilterValue]);

  useEffect(() => { void load(); }, [load]);

  const paidConnected = Boolean(data?.datasources.facebook) || Boolean(data?.datasources.meta_ads) || Boolean(data?.demo);
  const paidRows = useMemo(() => data?.posts.filter((p) => p.source === "paid") ?? [], [data]);
  const organicRows = useMemo(() => data?.posts.filter((p) => p.source === "organic") ?? [], [data]);
  const platformOptions = useMemo(
    () => [...new Set((data?.posts ?? []).map((p) => p.platform))].sort((a, b) => PLATFORM_LABEL[a].localeCompare(PLATFORM_LABEL[b], "pt-BR")),
    [data],
  );
  useEffect(() => {
    if (platformFilterValue && !platformOptions.includes(platformFilterValue)) {
      setFilters((f) => f.filter((x) => x.attr !== "rede"));
    }
  }, [platformFilterValue, platformOptions]);

  const currentPaidRows = useMemo(
    () => filterPosts(paidRows.filter((p) => inPeriod(p, period)), { platform: platformFilterValue || undefined }),
    [paidRows, period, platformFilterValue],
  );
  const prevPaidRows = useMemo(
    () => filterPosts(paidRows.filter((p) => inPeriod(p, prevPeriodRange)), { platform: platformFilterValue || undefined }),
    [paidRows, prevPeriodRange, platformFilterValue],
  );
  const currentOrganicRows = useMemo(
    () => filterPosts(organicRows.filter((p) => inPeriod(p, period)), { platform: platformFilterValue || undefined }),
    [organicRows, period, platformFilterValue],
  );
  const prevOrganicRows = useMemo(
    () => filterPosts(organicRows.filter((p) => inPeriod(p, prevPeriodRange)), { platform: platformFilterValue || undefined }),
    [organicRows, prevPeriodRange, platformFilterValue],
  );

  // Which row set a given card should read from — "Categoria: Ads/Orgânico"
  // is uniform for every card; "Ambos" defers to that card's own toggle
  // (default Pago) so paid and organic numbers never get summed together.
  const rowsFor = useCallback((cardKey: string): { current: MetaPost[]; prev: MetaPost[] } => {
    if (category === "organico") return { current: currentOrganicRows, prev: prevOrganicRows };
    if (category === "ambos") {
      const source = ambosSource[cardKey] ?? "paid";
      return source === "paid" ? { current: currentPaidRows, prev: prevPaidRows } : { current: currentOrganicRows, prev: prevOrganicRows };
    }
    return { current: currentPaidRows, prev: prevPaidRows };
  }, [category, ambosSource, currentPaidRows, prevPaidRows, currentOrganicRows, prevOrganicRows]);

  function setAmbosCardSource(cardKey: string, source: AmbosSource) {
    setAmbosSource((m) => ({ ...m, [cardKey]: source }));
  }

  // Trend/Mix can independently read paid or organic (Ambos), so their pill/
  // select lists show a metric if it's available in EITHER row set. Top
  // campanhas and the Campanhas table are always paid — "campanha" is an ads
  // concept — so they use a paid-only option list.
  const allCurrentRows = useMemo(() => [...currentPaidRows, ...currentOrganicRows], [currentPaidRows, currentOrganicRows]);
  const metricPillOptions = useMemo(() => metricRefOptions(allCurrentRows, customMetrics), [allCurrentRows, customMetrics]);
  const paidMetricPillOptions = useMemo(() => metricRefOptions(currentPaidRows, customMetrics), [currentPaidRows, customMetrics]);

  useEffect(() => {
    if (metricPillOptions.length && !metricPillOptions.some((m) => m.ref === trendMetric)) setTrendMetric(metricPillOptions[0].ref);
  }, [metricPillOptions, trendMetric]);
  useEffect(() => {
    if (paidMetricPillOptions.length && !paidMetricPillOptions.some((m) => m.ref === topCampaignsMetric)) {
      setTopCampaignsMetric(paidMetricPillOptions[0].ref);
    }
  }, [paidMetricPillOptions, topCampaignsMetric]);

  const trendRows = rowsFor("trend");
  const mixRows = rowsFor("mix");
  const trend = useMemo(() => trendSeries(trendRows.current, trendMetric, period, customMetrics), [trendRows.current, trendMetric, period, customMetrics]);
  const top = useMemo(() => topCampaigns(currentPaidRows, topCampaignsMetric, 8, customMetrics), [currentPaidRows, topCampaignsMetric, customMetrics]);
  const mix = useMemo(() => engagementMix(mixRows.current, mixMetric, customMetrics), [mixRows.current, mixMetric, customMetrics]);

  const campaignsAll = useMemo(
    () => sortCampaigns(campaignSummaries(currentPaidRows), sortKey, sortDir),
    [currentPaidRows, sortKey, sortDir],
  );
  const campaigns = useMemo(() => campaignsAll.slice(0, visibleCount), [campaignsAll, visibleCount]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [period.from, period.to, clientFilterValue, platformFilterValue]);

  const columns = useMemo(
    () => CAMPAIGN_METRIC_COLUMNS.filter((c) => visibleColumns.includes(c.key)),
    [visibleColumns],
  );

  function choosePreset(days: PeriodPreset) {
    setPreset(days);
    setCustomFrom("");
    setCustomTo("");
    persistPrefs({ defaultPeriod: days });
  }

  function setCustomRange(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
  }

  function toggleSort(key: MetaPostMetricKey) {
    const nextDir: SortDir = sortKey === key && sortDir === "desc" ? "asc" : "desc";
    setSortKey(key);
    setSortDir(nextDir);
    persistPrefs({ sortKey: key, sortDir: nextDir });
  }

  function toggleColumn(key: MetaPostMetricKey) {
    setVisibleColumns((cols) => {
      const next = cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
      const ordered = CAMPAIGN_METRIC_COLUMNS.map((c) => c.key).filter((k) => next.includes(k));
      persistPrefs({ visibleColumns: ordered });
      return ordered;
    });
  }

  function isKpiActive(ref: MetricRef): boolean {
    return kpiSlots.some((s) => s.metric === ref && s.visible);
  }
  function toggleKpiMetric(ref: MetricRef) {
    setKpiSlots((slots) => {
      const idx = slots.findIndex((s) => s.metric === ref);
      const next = idx === -1
        ? [...slots, { visible: true, metric: ref }]
        : slots.map((s, i) => (i === idx ? { ...s, visible: !s.visible } : s));
      persistPrefs({ kpiSlots: next });
      return next;
    });
  }

  function pickTrendMetric(ref: MetricRef) { setTrendMetric(ref); persistPrefs({ trendMetric: ref }); }
  function pickTopCampaignsMetric(ref: MetricRef) { setTopCampaignsMetric(ref); persistPrefs({ topCampaignsMetric: ref }); }
  function pickMixMetric(index: 0 | 1 | 2 | 3, ref: MetricRef) {
    setMixMetric((current) => {
      const next = [...current] as [MetricRef, MetricRef, MetricRef, MetricRef];
      next[index] = ref;
      persistPrefs({ mixMetric: next });
      return next;
    });
  }

  function saveCustomMetric(newMetric: CustomMetric) {
    setCustomMetrics((current) => {
      const next = [...current, newMetric];
      persistPrefs({ customMetrics: next });
      return next;
    });
  }
  function deleteCustomMetric(id: string) {
    const ref: MetricRef = `custom:${id}`;
    const patch: Partial<PerformanceViewPrefs> = {};
    setCustomMetrics((current) => {
      patch.customMetrics = current.filter((m) => m.id !== id);
      return patch.customMetrics;
    });
    setKpiSlots((slots) => {
      patch.kpiSlots = slots.filter((s) => s.metric !== ref);
      return patch.kpiSlots;
    });
    if (trendMetric === ref) { setTrendMetric(PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric); patch.trendMetric = PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric; }
    if (topCampaignsMetric === ref) { setTopCampaignsMetric(PERFORMANCE_VIEW_PREFS_DEFAULT.topCampaignsMetric); patch.topCampaignsMetric = PERFORMANCE_VIEW_PREFS_DEFAULT.topCampaignsMetric; }
    if (mixMetric.includes(ref)) {
      const nextMix = mixMetric.map((m, i) => (m === ref ? PERFORMANCE_VIEW_PREFS_DEFAULT.mixMetric[i] : m)) as [MetricRef, MetricRef, MetricRef, MetricRef];
      setMixMetric(nextMix);
      patch.mixMetric = nextMix;
    }
    persistPrefs(patch);
  }

  function exportCsv() {
    const cols: { label: string; get: (c: CampaignSummary) => string }[] = [
      { label: "Plataforma", get: (c) => PLATFORM_LABEL[c.platform] },
      { label: "Conta", get: (c) => c.accountName },
      { label: "Campanha", get: (c) => c.caption },
      { label: "Objetivo", get: (c) => (c.objective ? OBJECTIVE_LABEL[c.objective] ?? c.objective : "") },
      ...columns.map((col) => ({
        label: col.label,
        get: (c: CampaignSummary) => {
          const v = c.metrics[col.key];
          return v !== undefined ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "";
        },
      })),
    ];
    const lines = [cols.map((c) => csvCell(c.label)).join(";")];
    for (const c of campaignsAll) lines.push(cols.map((col) => csvCell(col.get(c))).join(";"));
    const blob = new Blob([String.fromCharCode(0xfeff) + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campanhas_${period.from}_a_${period.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function adCacheKey(c: CampaignSummary): string {
    return `${c.key}__${period.from}__${period.to}`;
  }

  async function toggleExpand(c: CampaignSummary) {
    if (expanded === c.key) { setExpanded(null); return; }
    setExpanded(c.key);
    if (!c.campaignId) return;
    const cacheKey = adCacheKey(c);
    if (adRows[cacheKey]) return;
    setAdRows((m) => ({ ...m, [cacheKey]: { loading: true, error: "", ads: [] } }));
    try {
      const params = new URLSearchParams({ account: c.accountId, campaign: c.campaignId, from: period.from, to: period.to });
      const res = await fetch(`/api/admin/performance/insights/ads?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "");
      const ads = adSummaries((body.ads ?? []) as MetaPost[]);
      setAdRows((m) => ({ ...m, [cacheKey]: { loading: false, error: "", ads } }));
    } catch (e) {
      setAdRows((m) => ({
        ...m,
        [cacheKey]: { loading: false, error: e instanceof Error && e.message ? e.message : "Não foi possível carregar os anúncios.", ads: [] },
      }));
    }
  }

  function AmbosToggle({ cardKey }: { cardKey: string }) {
    if (category !== "ambos") return null;
    const source = ambosSource[cardKey] ?? "paid";
    return (
      <div className="perf-ambos-toggle" role="group" aria-label="Fonte dos dados">
        <button type="button" className={source === "paid" ? "on" : ""} onClick={() => setAmbosCardSource(cardKey, "paid")}>Pago</button>
        <button type="button" className={source === "organic" ? "on" : ""} onClick={() => setAmbosCardSource(cardKey, "organic")}>Orgânico</button>
      </div>
    );
  }

  return (
    <div className="perf-dash">
      <div className="perf-filters">
        <DateRangeField
          from={period.from}
          to={period.to}
          onChange={setCustomRange}
          presets={DATE_PRESETS}
          activePreset={customRangeValid ? null : preset}
          onPreset={(days) => choosePreset(days as PeriodPreset)}
        />
        <PerformanceFilterBar
          clients={clients}
          platformOptions={platformOptions}
          platformLabel={PLATFORM_LABEL}
          filters={filters}
          onFiltersChange={setFilters}
        />
        <span className={`kb-loadspin ${loading ? "on" : ""}`} role="status" aria-hidden={!loading} />
        <div className="kb-spacer" />
        {data?.demo ? <span className="perf-demo-chip">Dados de demonstração</span> : null}
        {data?.stale ? <span className="perf-demo-chip perf-stale-chip" title={data.error}>Dados desatualizados</span> : null}
        <button className="admin-btn ghost" onClick={() => void load(true)} disabled={loading || Boolean(data?.demo)}>
          Atualizar dados
        </button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}
      {!loading && !error && !paidConnected ? <p className="admin-error">Conecte uma conta Meta Ads para carregar dados pagos reais.</p> : null}

      <div className="perf-kpis-head">
        <p className="perf-kpis-title">KPIs</p>
        <div className="perf-kpis-head-actions">
          <button className="admin-btn ghost small" onClick={() => setCustomMetricsOpen(true)}>+ Métrica personalizada</button>
          <div className="perf-columns-menu">
            <button className="admin-btn ghost small" onClick={() => setKpiMenuOpen((v) => !v)}>⚙ KPIs</button>
            {kpiMenuOpen ? (
              <div className="perf-columns-dropdown">
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
                <button className="admin-btn ghost small perf-columns-close" onClick={() => setKpiMenuOpen(false)}>Fechar</button>
              </div>
            ) : null}
          </div>
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
                {available ? metricValue(value, !isCustomMetricRef(slot.metric) && slot.metric === "custo" ? "money" : "number", rows.current[0]?.currency) : "—"}
              </strong>
              {available && delta !== null ? (
                <span className={`perf-kpi-delta ${delta >= 0 ? "up" : "down"}`}>
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs período anterior
                </span>
              ) : (
                <span className="perf-kpi-delta muted">— sem comparação disponível</span>
              )}
              <AmbosToggle cardKey={cardKey} />
            </div>
          );
        })}
        {kpiSlots.every((s) => !s.visible) ? <p className="perf-empty">Nenhum KPI selecionado — use "⚙ KPIs" para escolher.</p> : null}
      </div>

      <div className="perf-card perf-trend">
        <div className="perf-card-head">
          <div><h3>Tendência diária dos anúncios</h3><p className="perf-card-sub">Somente dados pagos retornados pela Meta.</p></div>
          <div className="perf-metric-pills">
            {metricPillOptions.map((m) => (
              <button key={m.ref} className={`kb-chip ${trendMetric === m.ref ? "on" : ""}`} onClick={() => pickTrendMetric(m.ref)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <AmbosToggle cardKey="trend" />
        <TrendChart data={trend} label={metricRefLabel(trendMetric, customMetrics)} />
      </div>

      <div className="perf-two-up">
        <div className="perf-card">
          <div className="perf-card-head">
            <div><h3>Top campanhas · {metricRefLabel(topCampaignsMetric, customMetrics)}</h3>{category !== "ads" ? <p className="perf-card-sub">Campanha é um conceito de mídia paga — esta lista continua sempre em Ads.</p> : null}</div>
            <div className="perf-metric-pills">
              {paidMetricPillOptions.map((m) => (
                <button key={m.ref} className={`kb-chip ${topCampaignsMetric === m.ref ? "on" : ""}`} onClick={() => pickTopCampaignsMetric(m.ref)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {top.length ? <PostsBarChart posts={top.map((c) => ({ key: c.key, caption: c.caption, platform: c.platform, value: campaignMetricValue(c, topCampaignsMetric, customMetrics) }))} label={metricRefLabel(topCampaignsMetric, customMetrics)} /> : <p className="perf-empty">Sem campanhas com essa métrica no período.</p>}
        </div>
        <div className="perf-card">
          <div className="perf-card-head">
            <h3>Engajamento dos anúncios</h3>
            <div className="perf-columns-menu">
              <button className="admin-btn ghost small" onClick={() => setMixMenuOpen((v) => !v)}>⚙ Métricas</button>
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
          </div>
          <AmbosToggle cardKey="mix" />
          {mix.length ? <MixDonut slices={mix} /> : <p className="perf-empty">A Meta não retornou interações no período.</p>}
        </div>
      </div>

      <div className="perf-card">
        <div className="perf-card-head">
          <div>
            <h3>Campanhas</h3>
            <p className="perf-card-sub">
              {campaignsAll.length} campanha{campaignsAll.length === 1 ? "" : "s"} por plataforma no período
              {category !== "ads" ? " · sempre em Ads (campanha é um conceito de mídia paga)" : ""}
            </p>
          </div>
          <div className="perf-table-actions">
            <div className="perf-columns-menu">
              <button className="admin-btn ghost small" onClick={() => setColumnsMenuOpen((v) => !v)}>Colunas ({columns.length})</button>
              {columnsMenuOpen ? (
                <div className="perf-columns-dropdown">
                  {CAMPAIGN_METRIC_COLUMNS.map((c) => (
                    <label key={c.key} className="perf-columns-item">
                      <input type="checkbox" checked={visibleColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                      {c.label}
                    </label>
                  ))}
                  <button className="admin-btn ghost small perf-columns-close" onClick={() => setColumnsMenuOpen(false)}>Fechar</button>
                </div>
              ) : null}
            </div>
            <button className="admin-btn ghost small" onClick={exportCsv} disabled={campaignsAll.length === 0}>Exportar CSV</button>
          </div>
        </div>
        <div className="admin-table-wrap perf-table-wrap">
          <table className="admin-table perf-table perf-ads-table">
            <thead>
              <tr>
                <th aria-label="Expandir" />
                <th>Plataforma</th><th>Conta</th><th>Campanha</th><th>Objetivo</th>
                {columns.map((c) => (
                  <th key={c.key} className="perf-th-sort" onClick={() => toggleSort(c.key)} aria-sort={sortKey === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const ads = adRows[adCacheKey(c)];
                const isExpanded = expanded === c.key;
                return (
                  <Fragment key={c.key}>
                    <tr className="perf-row-link" onClick={() => toggleExpand(c)}>
                      <td className="perf-expand-cell">{c.campaignId ? (isExpanded ? "▾" : "▸") : ""}</td>
                      <td><span className={`kb-type ${platformTone(c.platform)}`}>{PLATFORM_LABEL[c.platform]}</span></td>
                      <td className="admin-cell-muted">{c.accountName}</td>
                      <td className="perf-td-caption" title={c.caption}>{c.caption || "—"}</td>
                      <td className="admin-cell-muted">{c.objective ? OBJECTIVE_LABEL[c.objective] ?? c.objective : "—"}</td>
                      {columns.map((col) => (
                        <td key={col.key}>{metricValue(c.metrics[col.key], COLUMN_KIND[col.key] ?? "number", c.currency)}</td>
                      ))}
                    </tr>
                    {isExpanded ? (
                      <tr className="perf-ad-subrow">
                        <td colSpan={5 + columns.length}>
                          {!c.campaignId ? (
                            <p className="perf-empty">Detalhamento por anúncio disponível apenas para campanhas da conexão direta com a Meta.</p>
                          ) : ads?.loading ? (
                            <p className="perf-empty">Carregando anúncios…</p>
                          ) : ads?.error ? (
                            <p className="admin-error">{ads.error}</p>
                          ) : ads && ads.ads.length === 0 ? (
                            <p className="perf-empty">Nenhum anúncio individual retornado para esta campanha no período.</p>
                          ) : ads ? (
                            <table className="admin-table perf-ad-subtable">
                              <thead>
                                <tr>
                                  <th>Anúncio</th><th>Alcance</th><th>Impressões</th><th>Engajamento</th>
                                  <th>Cliques link</th><th>CTR</th><th>CPC</th><th>Investimento</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ads.ads.map((ad) => (
                                  <tr key={ad.key}>
                                    <td className="perf-ad-name-cell">
                                      {ad.thumbnailUrl ? <img className="perf-ad-thumb" src={ad.thumbnailUrl} alt="" /> : null}
                                      <span title={ad.adName}>{ad.adName}</span>
                                    </td>
                                    <td>{metricValue(ad.metrics.alcance)}</td>
                                    <td>{metricValue(ad.metrics.impressoes)}</td>
                                    <td>{metricValue(ad.metrics.engajamento)}</td>
                                    <td>{metricValue(ad.metrics.cliquesLink)}</td>
                                    <td>{metricValue(ad.metrics.ctr, "percent")}</td>
                                    <td>{metricValue(ad.metrics.cpc, "money", ad.currency)}</td>
                                    <td>{metricValue(ad.metrics.custo, "money", ad.currency)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {campaigns.length === 0 ? <tr><td colSpan={5 + columns.length} className="perf-empty">Nenhum anúncio pago no período com os filtros atuais.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {campaignsAll.length > campaigns.length ? (
          <div className="perf-pagination">
            <button className="admin-btn ghost" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              Carregar mais ({campaigns.length} de {campaignsAll.length})
            </button>
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
    </div>
  );
}
