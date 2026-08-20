"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MixDonut from "./charts/MixDonut";
import PostsBarChart from "./charts/PostsBarChart";
import TrendChart, { type TrendSeriesDefinition } from "./charts/TrendChart";
import CustomMetricsPanel from "./CustomMetricsPanel";
import PerformanceEntityTable from "./PerformanceEntityTable";
import MetricSettingsMenu from "./MetricSettingsMenu";
import DateRangeField from "../DateRangeField";
import PerformanceFilterBar, { type PerfActiveFilter, type PerfCategory } from "./PerformanceFilterBar";
import {
  DASH_METRICS, adSummaries, campaignMetricValue, campaignSummaries, engagementMix, filterPosts, fmtCompact,
  hasMetric, inPeriod, metricRefAvailable, metricRefLabel, previousPeriod, resolveMetricValue, sortCampaigns,
  topCampaigns, trendSeries, performanceEntitySummaries,
  type AdSummary, type CampaignSummary, type Period, type PerformanceEntitySummary,
} from "./insights";
import {
  CAMPAIGN_METRIC_COLUMNS, PERFORMANCE_VIEW_PREFS_DEFAULT, isCustomMetricRef,
  type CustomMetric, type KpiSlot, type MetricRef, type PeriodPreset, type PerformanceViewPrefs, type SortDir,
} from "@/lib/performancePrefs";
import type { MetaPlatform, MetaPost, MetaPostMetricKey, WindsorDatasource } from "@/lib/windsor";
import { sanitizePerformanceTemplateConfig, type PerformanceEntityLevel, type PerformanceTemplate, type PerformanceTemplateConfig } from "@/lib/performanceTemplates";

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

function metricRefKind(ref: MetricRef, customMetrics: CustomMetric[]): "number" | "money" | "percent" | "decimal" {
  if (isCustomMetricRef(ref)) return customMetrics.find((metric) => `custom:${metric.id}` === ref)?.format ?? "number";
  return COLUMN_KIND[ref] ?? "number";
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
  const [trendMetrics, setTrendMetrics] = useState<MetricRef[]>([PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric]);
  const [customMetricsOpen, setCustomMetricsOpen] = useState(false);
  const [templates, setTemplates] = useState<PerformanceTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateSaveRequest, setTemplateSaveRequest] = useState(0);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<string[]>([]);
  const [selectedAdIds, setSelectedAdIds] = useState<string[]>([]);
  const [entityLevel, setEntityLevel] = useState<PerformanceEntityLevel>("campaign");
  const [entityRows, setEntityRows] = useState<MetaPost[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);
  const [entityError, setEntityError] = useState("");
  // "Ambos" per-card Pago/Orgânico toggle, keyed by a small card id
  // ("trend"/"mix"/"kpi:<metric>"). It is part of the shared template;
  // a missing entry defaults safely to "paid".
  const [ambosSource, setAmbosSource] = useState<Record<string, AmbosSource>>({});

  const prefsAppliedRef = useRef(false);

  const customRangeValid = Boolean(customFrom && customTo && customFrom <= customTo);
  const period = useMemo(
    () => (customRangeValid ? { from: customFrom, to: customTo } : presetPeriod(preset)),
    [customRangeValid, customFrom, customTo, preset],
  );
  const prevPeriodRange = useMemo(() => previousPeriod(period), [period]);

  const clientFilterValue = useMemo(() => filters.find((f) => f.attr === "cliente")?.value ?? "", [filters]);
  const category = useMemo<PerfCategory>(() => (filters.find((f) => f.attr === "categoria")?.value as PerfCategory) ?? "ads", [filters]);
  const platformFilterValue = useMemo(() => (filters.find((f) => f.attr === "rede")?.value as MetaPlatform | undefined) ?? "", [filters]);
  const objectiveFilterValues = useMemo(() => filters.find((f) => f.attr === "objetivo")?.value.split(",").filter(Boolean) ?? [], [filters]);

  const applyTemplate = useCallback((template: PerformanceTemplate) => {
    const config = sanitizePerformanceTemplateConfig(template.config);
    const prefs = config.prefs;
    setSortKey(prefs.sortKey); setSortDir(prefs.sortDir); setVisibleColumns(prefs.visibleColumns);
    setPreset(prefs.defaultPeriod);
    setCustomFrom(config.dateRange?.from ?? "");
    setCustomTo(config.dateRange?.to ?? "");
    setKpiSlots(prefs.kpiSlots);
    setTrendMetric(prefs.trendMetric); setTrendMetrics(config.trendMetrics);
    setTopCampaignsMetric(prefs.topCampaignsMetric); setMixMetric(prefs.mixMetric); setCustomMetrics(prefs.customMetrics);
    const nextFilters: PerfActiveFilter[] = [];
    if (config.filters.category !== "ads") nextFilters.push({ attr: "categoria", value: config.filters.category, label: config.filters.category === "organico" ? "Orgânico" : "Ambos" });
    if (config.filters.platforms[0]) nextFilters.push({ attr: "rede", value: config.filters.platforms[0], label: PLATFORM_LABEL[config.filters.platforms[0]] });
    if (config.filters.objectives.length) {
      const labels = config.filters.objectives.map((value) => OBJECTIVE_LABEL[value] ?? value);
      nextFilters.push({ attr: "objetivo", value: config.filters.objectives.join(","), label: labels.length > 2 ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}` : labels.join(", ") });
    }
    // Cliente representa o contexto de consulta atual, não a configuração
    // compartilhada do template. Trocar de template nunca troca o cliente.
    setFilters((current) => {
      const client = current.find((filter) => filter.attr === "cliente");
      return client ? [client, ...nextFilters] : nextFilters;
    });
    setSelectedCampaignIds(config.selectedCampaignIds);
    setSelectedAdsetIds(config.selectedAdsetIds);
    setSelectedAdIds(config.selectedAdIds);
    setEntityLevel(config.level);
    setAmbosSource(config.cardSources);
    setActiveTemplateId(template.id);
    setTemplateDirty(false);
    setTemplateError("");
  }, []);

  // Named templates supersede the old single shared preference. The old
  // preference remains a safe fallback while the migration rolls out.
  useEffect(() => {
    (async () => {
      try {
        const [templateRes, prefsRes] = await Promise.all([
          fetch("/api/admin/performance/templates", { cache: "no-store" }),
          fetch("/api/admin/performance/prefs", { cache: "no-store" }),
        ]);
        if (!templateRes.ok) throw new Error("Não foi possível carregar os templates.");
        const body = await templateRes.json() as { templates: PerformanceTemplate[] };
        if (prefsAppliedRef.current) return;
        prefsAppliedRef.current = true;
        setTemplates(body.templates);
        if (body.templates[0]) applyTemplate(body.templates[0]);
        else if (prefsRes.ok) {
          const prefs = await prefsRes.json() as PerformanceViewPrefs;
          setSortKey(prefs.sortKey); setSortDir(prefs.sortDir); setVisibleColumns(prefs.visibleColumns);
          setPreset(prefs.defaultPeriod); setKpiSlots(prefs.kpiSlots); setTrendMetric(prefs.trendMetric);
          setTrendMetrics([prefs.trendMetric]); setTopCampaignsMetric(prefs.topCampaignsMetric);
          setMixMetric(prefs.mixMetric); setCustomMetrics(prefs.customMetrics);
        }
      } catch {
        setTemplateError("Não foi possível carregar os templates; usando a visão padrão.");
      }
    })();
  }, [applyTemplate]);

  const persistPrefs = useCallback((_patch: Partial<PerformanceViewPrefs>) => setTemplateDirty(true), []);

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
    if (data && platformFilterValue && !platformOptions.includes(platformFilterValue)) {
      setFilters((f) => f.filter((x) => x.attr !== "rede"));
    }
  }, [data, platformFilterValue, platformOptions]);

  const listedCurrentPaidRows = useMemo(
    () => filterPosts(paidRows.filter((p) => inPeriod(p, period) && (!objectiveFilterValues.length || (p.objective && objectiveFilterValues.includes(p.objective)))), { platform: platformFilterValue || undefined }),
    [paidRows, period, platformFilterValue, objectiveFilterValues],
  );
  const listedPrevPaidRows = useMemo(
    () => filterPosts(paidRows.filter((p) => inPeriod(p, prevPeriodRange) && (!objectiveFilterValues.length || (p.objective && objectiveFilterValues.includes(p.objective)))), { platform: platformFilterValue || undefined }),
    [paidRows, prevPeriodRange, platformFilterValue, objectiveFilterValues],
  );
  const campaignCurrentPaidRows = useMemo(() => selectedCampaignIds.length ? listedCurrentPaidRows.filter((post) => post.campaignId && selectedCampaignIds.includes(post.campaignId)) : listedCurrentPaidRows, [listedCurrentPaidRows, selectedCampaignIds]);
  const campaignPrevPaidRows = useMemo(() => selectedCampaignIds.length ? listedPrevPaidRows.filter((post) => post.campaignId && selectedCampaignIds.includes(post.campaignId)) : listedPrevPaidRows, [listedPrevPaidRows, selectedCampaignIds]);
  const selectedEntityIds = entityLevel === "adset" ? selectedAdsetIds : selectedAdIds;
  const currentPaidRows = useMemo(() => {
    if (entityLevel === "campaign") return campaignCurrentPaidRows;
    if (entityRows.length === 0 && (entityLoading || entityError)) return campaignCurrentPaidRows;
    return entityRows.filter((post) => inPeriod(post, period) && (!selectedEntityIds.length || selectedEntityIds.includes(entityLevel === "adset" ? post.adsetId ?? "" : post.adId ?? "")));
  }, [entityLevel, campaignCurrentPaidRows, entityRows, entityLoading, entityError, period, selectedEntityIds]);
  const prevPaidRows = useMemo(() => {
    if (entityLevel === "campaign") return campaignPrevPaidRows;
    if (entityRows.length === 0 && (entityLoading || entityError)) return campaignPrevPaidRows;
    return entityRows.filter((post) => inPeriod(post, prevPeriodRange) && (!selectedEntityIds.length || selectedEntityIds.includes(entityLevel === "adset" ? post.adsetId ?? "" : post.adId ?? "")));
  }, [entityLevel, campaignPrevPaidRows, entityRows, entityLoading, entityError, prevPeriodRange, selectedEntityIds]);
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
    setTemplateDirty(true);
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
  const comparisonIds = useMemo(
    () => entityLevel === "campaign" ? selectedCampaignIds : entityLevel === "adset" ? selectedAdsetIds : selectedAdIds,
    [entityLevel, selectedCampaignIds, selectedAdsetIds, selectedAdIds],
  );
  const comparisonGroups = useMemo(() => {
    const source = entityLevel === "campaign" ? listedCurrentPaidRows : entityRows;
    return comparisonIds.map((id) => {
      const rows = source.filter((post) => entityLevel === "campaign" ? post.campaignId === id : entityLevel === "adset" ? post.adsetId === id : post.adId === id);
      const first = rows[0];
      const label = entityLevel === "campaign" ? first?.campaignName : entityLevel === "adset" ? first?.adsetName : first?.adName;
      return { id, label: label || `${entityLevel === "campaign" ? "Campanha" : entityLevel === "adset" ? "Conjunto" : "Criativo"} ${id.slice(0, 6)}`, rows };
    });
  }, [entityLevel, comparisonIds, listedCurrentPaidRows, entityRows]);
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

  const campaignsAll = useMemo(
    () => sortCampaigns(campaignSummaries(listedCurrentPaidRows), sortKey, sortDir),
    [listedCurrentPaidRows, sortKey, sortDir],
  );
  useEffect(() => {
    if (entityLevel === "campaign") { setEntityRows([]); setEntityError(""); return; }
    if (selectedCampaignIds.length === 0) { setEntityRows([]); setEntityError(""); return; }
    const controller = new AbortController();
    const parents = new Map<string, { accountId: string; campaignId: string }>();
    for (const campaign of campaignsAll) {
      if (campaign.campaignId && selectedCampaignIds.includes(campaign.campaignId)) {
        parents.set(`${campaign.accountId}:${campaign.campaignId}`, { accountId: campaign.accountId, campaignId: campaign.campaignId });
      }
    }
    setEntityLoading(true);
    setEntityError("");
    void Promise.all([...parents.values()].map(async (parent) => {
      const params = new URLSearchParams({ account: parent.accountId, campaign: parent.campaignId, from: prevPeriodRange.from, to: period.to, level: entityLevel });
      const response = await fetch(`/api/admin/performance/insights/ads?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar o detalhamento.");
      return (body.rows ?? body.ads ?? []) as MetaPost[];
    })).then((rows) => setEntityRows(rows.flat())).catch((loadError) => {
      if (!controller.signal.aborted) setEntityError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o detalhamento.");
    }).finally(() => { if (!controller.signal.aborted) setEntityLoading(false); });
    return () => controller.abort();
  }, [entityLevel, selectedCampaignIds, campaignsAll, prevPeriodRange.from, period.to]);

  const entitySummaries = useMemo(() => entityLevel === "campaign" ? [] : performanceEntitySummaries(entityRows.filter((post) => inPeriod(post, period)), entityLevel), [entityLevel, entityRows, period]);
  const topRows = useMemo(() => entityLevel === "campaign"
    ? campaignTop.map((row) => ({ key: row.key, caption: row.caption, platform: row.platform, value: campaignMetricValue(row, topCampaignsMetric, customMetrics) }))
    : entitySummaries.slice().sort((a, b) => campaignMetricValue(b, topCampaignsMetric, customMetrics) - campaignMetricValue(a, topCampaignsMetric, customMetrics)).slice(0, 8).map((row) => ({ key: row.key, caption: row.name, platform: row.platform, value: campaignMetricValue(row, topCampaignsMetric, customMetrics) })),
  [entityLevel, campaignTop, entitySummaries, topCampaignsMetric, customMetrics]);
  const campaigns = useMemo(() => campaignsAll.slice(0, visibleCount), [campaignsAll, visibleCount]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [period.from, period.to, clientFilterValue, platformFilterValue]);

  const columns = useMemo(
    () => CAMPAIGN_METRIC_COLUMNS.filter((c) => visibleColumns.includes(c.key)),
    [visibleColumns],
  );

  function currentTemplateConfig(): PerformanceTemplateConfig {
    return sanitizePerformanceTemplateConfig({
      version: 1,
      prefs: { visibleColumns, sortKey, sortDir, defaultPeriod: preset, kpiSlots, trendMetric, topCampaignsMetric, mixMetric, customMetrics },
      filters: { clientSlug: "", category, platforms: platformFilterValue ? [platformFilterValue] : [], objectives: objectiveFilterValues },
      dateRange: customRangeValid ? { from: customFrom, to: customTo } : null,
      cardSources: ambosSource,
      level: entityLevel,
      selectedCampaignIds,
      selectedAdsetIds,
      selectedAdIds,
      trendMetrics,
    });
  }

  async function saveTemplate(input: { name: string; overwrite: boolean }): Promise<boolean> {
    setTemplateSaving(true);
    setTemplateError("");
    try {
      const active = templates.find((template) => template.id === activeTemplateId);
      const overwrite = input.overwrite && active && active.scope !== "builtin";
      const endpoint = overwrite ? `/api/admin/performance/templates/${active.id}` : "/api/admin/performance/templates";
      const response = await fetch(endpoint, {
        method: overwrite ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name.trim(), description: active?.description || "Visão personalizada de Analytics.", config: currentTemplateConfig() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o template.");
      const saved = body as PerformanceTemplate;
      setTemplates((current) => overwrite ? current.map((template) => template.id === saved.id ? saved : template) : [...current, saved]);
      setActiveTemplateId(saved.id);
      setTemplateDirty(false);
      return true;
    } catch (saveError) {
      setTemplateError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o template.");
      return false;
    } finally {
      setTemplateSaving(false);
    }
  }

  function changeFilters(next: PerfActiveFilter[]) {
    const templateFilters = (items: PerfActiveFilter[]) => items
      .filter((filter) => filter.attr !== "cliente")
      .map((filter) => `${filter.attr}:${filter.value}`)
      .sort()
      .join("|");
    if (templateFilters(filters) !== templateFilters(next)) setTemplateDirty(true);
    setFilters(next);
  }

  function toggleCampaignSelection(campaignId: string) {
    if (!campaignId) return;
    setSelectedCampaignIds((current) => current.includes(campaignId) ? current.filter((id) => id !== campaignId) : [...current, campaignId]);
    setTemplateDirty(true);
  }

  function toggleAllCampaigns() {
    const ids = [...new Set(campaignsAll.map((campaign) => campaign.campaignId).filter(Boolean))];
    const allSelected = ids.length > 0 && ids.every((id) => selectedCampaignIds.includes(id));
    setSelectedCampaignIds(allSelected ? [] : ids);
    setTemplateDirty(true);
  }

  function changeEntityLevel(level: PerformanceEntityLevel) {
    setEntityLevel(level);
    setTemplateDirty(true);
  }

  function toggleEntitySelection(id: string) {
    const setter = entityLevel === "adset" ? setSelectedAdsetIds : setSelectedAdIds;
    setter((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setTemplateDirty(true);
  }

  function toggleAllEntities() {
    const ids = entitySummaries.map((row) => row.id);
    const current = entityLevel === "adset" ? selectedAdsetIds : selectedAdIds;
    const setter = entityLevel === "adset" ? setSelectedAdsetIds : setSelectedAdIds;
    setter(ids.length > 0 && ids.every((id) => current.includes(id)) ? [] : ids);
    setTemplateDirty(true);
  }

  function clearEntitySelections() {
    setSelectedCampaignIds([]);
    setSelectedAdsetIds([]);
    setSelectedAdIds([]);
    setTemplateDirty(true);
  }

  function choosePreset(days: PeriodPreset) {
    setPreset(days);
    setCustomFrom("");
    setCustomTo("");
    persistPrefs({ defaultPeriod: days });
  }

  function setCustomRange(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    setTemplateDirty(true);
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

  function pickTrendMetric(ref: MetricRef) {
    setTrendMetrics((current) => {
      const next = current.includes(ref) ? (current.length === 1 ? current : current.filter((metric) => metric !== ref)) : [...current.slice(-1), ref];
      setTrendMetric(next[0]);
      return next;
    });
    persistPrefs({ trendMetric: ref });
  }
  function pickSingleTrendMetric(ref: MetricRef) {
    setTrendMetrics([ref]);
    setTrendMetric(ref);
    persistPrefs({ trendMetric: ref });
  }
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

  const activeEntitySelection = entityLevel === "campaign" ? selectedCampaignIds : entityLevel === "adset" ? selectedAdsetIds : selectedAdIds;
  const activeEntityLabel = entityLevel === "campaign" ? "campanha" : entityLevel === "adset" ? "conjunto" : "criativo";
  const hasSelectionContext = selectedCampaignIds.length > 0 || activeEntitySelection.length > 0;
  const selectionCount = activeEntitySelection.length || selectedCampaignIds.length;

  return (
    <div className="perf-dash">
      <div className="perf-analysis-toolbar">
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
          onFiltersChange={changeFilters}
          templates={templates}
          activeTemplateId={activeTemplateId}
          templateDirty={templateDirty}
          saveRequestToken={templateSaveRequest}
          canSaveTemplate={canEdit}
          templateSaving={templateSaving}
          onTemplateSelect={applyTemplate}
          onTemplateSave={saveTemplate}
        />
        {hasSelectionContext ? (
          <div className="perf-selection-compact" title={`${selectionCount} ${activeEntityLabel}${selectionCount === 1 ? "" : "s"} selecionado${selectionCount === 1 ? "" : "s"}`}>
            <button type="button" className="perf-selection-clear" aria-label="Limpar seleção" onClick={clearEntitySelections}>×</button>
            <strong aria-label={`${selectionCount} seleções`}>{selectionCount}</strong>
          </div>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className={`perf-toolbar-icon perf-save-template${templateDirty ? " is-dirty" : ""}`}
            aria-label={templateDirty ? "Salvar alterações do template" : "Salvar template"}
            title={templateDirty ? "Salvar alterações do template" : "Salvar template"}
            onClick={() => setTemplateSaveRequest((value) => value + 1)}
            disabled={templateSaving}
          >
            <svg viewBox="0 0 24 24" aria-hidden><path d="M5 4h11l3 3v13H5zM8 4v6h8V4M8 20v-6h8v6" /></svg>
          </button>
        ) : null}
        <button
          type="button"
          className={`perf-toolbar-icon perf-refresh${loading ? " is-loading" : ""}`}
          aria-label={loading ? "Atualizando dados" : "Atualizar dados"}
          title="Atualizar dados"
          onClick={() => void load(true)}
          disabled={loading || Boolean(data?.demo)}
        >
          <svg viewBox="0 0 24 24" aria-hidden><path d="M19 7v5h-5M5 17v-5h5M18 11a7 7 0 0 0-12-3L5 9m1 4a7 7 0 0 0 12 3l1-1" /></svg>
        </button>
        <div className="kb-spacer" />
        {data?.demo ? <span className="perf-demo-chip">Dados de demonstração</span> : null}
        {data?.stale ? <span className="perf-demo-chip perf-stale-chip" title={data.error}>Dados desatualizados</span> : null}
      </div>
      {templateError ? <p className="admin-error perf-template-error">{templateError}</p> : null}

      {error ? <p className="admin-error">{error}</p> : null}
      {!loading && !error && !paidConnected ? <p className="admin-error">Conecte uma conta Meta Ads para carregar dados pagos reais.</p> : null}

      <div className="perf-kpis-head">
        <p className="perf-kpis-title">KPIs</p>
        <div className="perf-kpis-head-actions">
          <div className="perf-columns-menu">
            <button className="perf-settings-trigger" aria-label="Configurar KPIs" aria-expanded={kpiMenuOpen} onClick={() => setKpiMenuOpen((v) => !v)}><span aria-hidden>⚙</span> Personalizar KPIs</button>
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
        {kpiSlots.every((s) => !s.visible) ? <p className="perf-empty">Nenhum KPI selecionado — use "⚙ KPIs" para escolher.</p> : null}
      </div>

      <div className="perf-card perf-trend">
        <div className="perf-card-head">
          <div><h3>Tendência diária</h3><p className="perf-card-sub">{isEntityComparison ? `Comparando ${comparisonGroups.length} ${activeEntityLabel}s pela métrica ${metricRefLabel(trendMetrics[0], customMetrics)}.` : "Compare até duas métricas. Todos os filtros e seleções são aplicados às séries."}</p></div>
          <MetricSettingsMenu label="métricas da tendência" options={metricPillOptions} selected={isEntityComparison ? [trendMetrics[0]] : trendMetrics} multiple={!isEntityComparison} max={2} onChange={isEntityComparison ? pickSingleTrendMetric : pickTrendMetric} />
        </div>
        <AmbosToggle visible={category === "ambos"} cardKey="trend" source={ambosSource.trend ?? "paid"} onChange={setAmbosCardSource} />
        <TrendChart data={trend} series={trendDefinitions} />
      </div>

      <div className="perf-two-up">
        <div className="perf-card">
          <div className="perf-card-head">
            <div><h3>Top {entityLevel === "campaign" ? "campanhas" : entityLevel === "adset" ? "conjuntos" : "criativos"} · {metricRefLabel(topCampaignsMetric, customMetrics)}</h3>{category !== "ads" ? <p className="perf-card-sub">A hierarquia de anúncios continua sempre em dados pagos.</p> : null}</div>
            <MetricSettingsMenu label="métrica do ranking" options={paidMetricPillOptions} selected={[topCampaignsMetric]} onChange={pickTopCampaignsMetric} />
          </div>
          {topRows.length ? <PostsBarChart posts={topRows} label={metricRefLabel(topCampaignsMetric, customMetrics)} formatValue={(value) => metricValue(value, metricRefKind(topCampaignsMetric, customMetrics), currentPaidRows[0]?.currency)} /> : <p className="perf-empty">Sem itens com essa métrica no período.</p>}
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
          <AmbosToggle visible={category === "ambos"} cardKey="mix" source={ambosSource.mix ?? "paid"} onChange={setAmbosCardSource} />
          {mix.length ? <MixDonut slices={mix} /> : <p className="perf-empty">A Meta não retornou interações no período.</p>}
        </div>
      </div>

      <div className="perf-card">
        <div className="perf-card-head">
          <div>
            <h3>{entityLevel === "campaign" ? "Campanhas" : entityLevel === "adset" ? "Conjuntos de anúncios" : "Criativos"}</h3>
            <p className="perf-card-sub">
              {entityLevel === "campaign" ? campaignsAll.length : entitySummaries.length} item{(entityLevel === "campaign" ? campaignsAll.length : entitySummaries.length) === 1 ? "" : "s"} por plataforma no período
              {category !== "ads" ? " · sempre em Ads (campanha é um conceito de mídia paga)" : ""}
            </p>
          </div>
          <div className="perf-table-actions">
            <div className="perf-level-toggle" role="group" aria-label="Nível da análise">
              <button type="button" className={entityLevel === "campaign" ? "on" : ""} onClick={() => changeEntityLevel("campaign")}>Campanhas</button>
              <button type="button" className={entityLevel === "adset" ? "on" : ""} onClick={() => changeEntityLevel("adset")}>Conjuntos</button>
              <button type="button" className={entityLevel === "ad" ? "on" : ""} onClick={() => changeEntityLevel("ad")}>Criativos</button>
            </div>
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
        {entityLevel !== "campaign" ? (
          <PerformanceEntityTable
            level={entityLevel}
            rows={entitySummaries}
            columns={columns}
            selectedIds={entityLevel === "adset" ? selectedAdsetIds : selectedAdIds}
            loading={entityLoading}
            error={entityError}
            onToggle={toggleEntitySelection}
            onToggleAll={toggleAllEntities}
            formatMetric={(value, key, currency) => metricValue(value, COLUMN_KIND[key] ?? "number", currency)}
          />
        ) : null}
        <div className={`admin-table-wrap perf-table-wrap ${entityLevel !== "campaign" ? "perf-hidden" : ""}`}>
          <table className="admin-table perf-table perf-ads-table">
            <thead>
              <tr>
                <th className="perf-select-cell"><input type="checkbox" aria-label="Selecionar todas as campanhas" checked={campaignsAll.length > 0 && campaignsAll.every((campaign) => campaign.campaignId && selectedCampaignIds.includes(campaign.campaignId))} onChange={toggleAllCampaigns} /></th>
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
                    <tr className={`perf-row-link ${selectedCampaignIds.includes(c.campaignId) ? "selected" : ""}`} onClick={() => toggleExpand(c)}>
                      <td className="perf-select-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Selecionar campanha ${c.caption}`} checked={selectedCampaignIds.includes(c.campaignId)} disabled={!c.campaignId} onChange={() => toggleCampaignSelection(c.campaignId)} /></td>
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
                        <td colSpan={6 + columns.length}>
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
              {campaigns.length === 0 ? <tr><td colSpan={6 + columns.length} className="perf-empty">Nenhum anúncio pago no período com os filtros atuais.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {entityLevel === "campaign" && campaignsAll.length > campaigns.length ? (
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
