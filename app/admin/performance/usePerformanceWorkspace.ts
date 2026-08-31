"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adSummaries, campaignSummaries, filterPosts, inPeriod, performanceEntitySummaries,
  previousPeriod, sortCampaigns, type AdSummary, type CampaignSummary, type Period, type PerformanceEntitySummary,
} from "./insights";
import { OBJECTIVE_LABEL, PLATFORM_LABEL } from "./performanceLabels";
import type { ChecklistOption, PerfActiveFilter, PerfCategory } from "./PerformanceCompositeFilter";
import { ACQUISITION_VIEW_PREFS_DEFAULT, type AcquisitionViewPrefs } from "@/lib/acquisitionPrefs";
import {
  CAMPAIGN_METRIC_COLUMNS, PERFORMANCE_VIEW_PREFS_DEFAULT,
  type PeriodPreset, type SortDir,
} from "@/lib/performancePrefs";
import {
  sanitizePerformanceTemplateConfig, type PerformanceEntityLevel, type PerformanceTemplate, type PerformanceTemplateConfig,
} from "@/lib/performanceTemplates";
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

const PAGE_SIZE = 25;
export const DATE_PRESETS = [7, 30, 90];

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presetPeriod(days: PeriodPreset): Period {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(today) };
}

function campaignKeyOf(post: MetaPost): string {
  return `${post.accountId}:${post.campaignId ?? ""}`;
}

// Single shared instance of everything Analytics and Aquisição have in
// common: period, base data fetch, the composite filter (Parte 2), the
// bottom Campanhas/Conjuntos/Criativos table + selection (Parte 3), and
// template identity (Parte 5). PerformanceScreen.tsx calls this once and
// passes the result to both dashboards, which stay mounted simultaneously
// (visibility toggled via CSS) so this really is one shared instance, not
// two independently-reconstructed copies. Per-card metric-slot config
// (Analytics' kpiSlots/trendMetric/etc, Aquisição's equivalent) stays local
// to each screen — see PerformanceDashboard.tsx/AcquisitionDashboard.tsx,
// which watch `activeTemplateId`/`activeTemplateConfig` to apply their own
// slice of a template.
export function usePerformanceWorkspace({ clients, canEdit }: { clients: ClientLite[]; canEdit: boolean }) {
  // ---- Period ----
  const [preset, setPreset] = useState<PeriodPreset>(PERFORMANCE_VIEW_PREFS_DEFAULT.defaultPeriod);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const customRangeValid = Boolean(customFrom && customTo && customFrom <= customTo);
  const period = useMemo(() => (customRangeValid ? { from: customFrom, to: customTo } : presetPeriod(preset)), [customRangeValid, customFrom, customTo, preset]);
  const prevPeriodRange = useMemo(() => previousPeriod(period), [period]);

  // ---- Composite filter (Template/Cliente/Categoria/Rede/Objetivo/Campanha/Conjunto) ----
  const [filters, setFilters] = useState<PerfActiveFilter[]>([]);
  const clientFilterValue = useMemo(() => filters.find((f) => f.attr === "cliente")?.value ?? "", [filters]);
  const category = useMemo<PerfCategory>(() => (filters.find((f) => f.attr === "categoria")?.value as PerfCategory) ?? "ads", [filters]);
  const platformFilterValue = useMemo(() => (filters.find((f) => f.attr === "rede")?.value as MetaPlatform | undefined) ?? "", [filters]);
  const objectiveFilterValues = useMemo(() => filters.find((f) => f.attr === "objetivo")?.value.split(",").filter(Boolean) ?? [], [filters]);

  const [templateDirty, setTemplateDirty] = useState(false);
  const markTemplateDirty = useCallback(() => setTemplateDirty(true), []);

  function changeFilters(next: PerfActiveFilter[]) {
    const templateFilters = (items: PerfActiveFilter[]) => items
      .filter((filter) => filter.attr !== "cliente")
      .map((filter) => `${filter.attr}:${filter.value}`)
      .sort()
      .join("|");
    if (templateFilters(filters) !== templateFilters(next)) markTemplateDirty();
    setFilters(next);
  }

  // ---- Base data fetch (one call shared by both screens) ----
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
  const objectiveOptions = useMemo(
    () => [...new Set(paidRows.map((p) => p.objective).filter((o): o is string => Boolean(o)))].sort((a, b) => (OBJECTIVE_LABEL[a] ?? a).localeCompare(OBJECTIVE_LABEL[b] ?? b, "pt-BR")),
    [paidRows],
  );
  useEffect(() => {
    if (data && platformFilterValue && !platformOptions.includes(platformFilterValue)) {
      setFilters((f) => f.filter((x) => x.attr !== "rede"));
    }
  }, [data, platformFilterValue, platformOptions]);

  // ---- Campanha/Conjunto/Criativo selection + shared bottom table ----
  const [entityLevel, setEntityLevel] = useState<PerformanceEntityLevel>("campaign");
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]); // "${accountId}:${campaignId}"
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<string[]>([]);
  const [selectedAdIds, setSelectedAdIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<MetaPostMetricKey>(PERFORMANCE_VIEW_PREFS_DEFAULT.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(PERFORMANCE_VIEW_PREFS_DEFAULT.sortDir);
  const [visibleColumns, setVisibleColumns] = useState<MetaPostMetricKey[]>(PERFORMANCE_VIEW_PREFS_DEFAULT.visibleColumns);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adRows, setAdRows] = useState<Record<string, AdRowsState>>({});
  const [ambosSource, setAmbosSource] = useState<Record<string, "paid" | "organic">>({});

  // Visibilidade de card por tela — cada tela tem seu próprio conjunto de
  // seções (ex.: Analytics tem "trend"/"topCampaigns"/"mix", Aquisição tem
  // "funnel"/"volume"/"gauges"), controlado por um único dropdown de olho
  // no topo compartilhado (PerformanceToolbar), por isso mora aqui e não
  // localmente em cada dashboard.
  const [hiddenSections, setHiddenSections] = useState<{ analytics: Set<string>; acquisition: Set<string> }>({ analytics: new Set(), acquisition: new Set() });
  const toggleSectionVisibility = useCallback((screen: "analytics" | "acquisition", key: string) => {
    setHiddenSections((prev) => {
      const next = new Set(prev[screen]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [screen]: next };
    });
  }, []);

  const listedCurrentPaidRows = useMemo(
    () => filterPosts(paidRows.filter((p) => inPeriod(p, period) && (!objectiveFilterValues.length || (p.objective && objectiveFilterValues.includes(p.objective)))), { platform: platformFilterValue || undefined }),
    [paidRows, period, platformFilterValue, objectiveFilterValues],
  );
  const listedPrevPaidRows = useMemo(
    () => filterPosts(paidRows.filter((p) => inPeriod(p, prevPeriodRange) && (!objectiveFilterValues.length || (p.objective && objectiveFilterValues.includes(p.objective)))), { platform: platformFilterValue || undefined }),
    [paidRows, prevPeriodRange, platformFilterValue, objectiveFilterValues],
  );
  const campaignsAll = useMemo(() => sortCampaigns(campaignSummaries(listedCurrentPaidRows), sortKey, sortDir), [listedCurrentPaidRows, sortKey, sortDir]);
  const campaignOptions = useMemo<ChecklistOption[]>(
    () => campaignsAll.filter((c) => c.campaignId).map((c) => ({ key: `${c.accountId}:${c.campaignId}`, label: c.caption || c.campaignId })),
    [campaignsAll],
  );

  const campaignCurrentPaidRows = useMemo(() => selectedCampaignIds.length ? listedCurrentPaidRows.filter((post) => post.campaignId && selectedCampaignIds.includes(campaignKeyOf(post))) : listedCurrentPaidRows, [listedCurrentPaidRows, selectedCampaignIds]);
  const campaignPrevPaidRows = useMemo(() => selectedCampaignIds.length ? listedPrevPaidRows.filter((post) => post.campaignId && selectedCampaignIds.includes(campaignKeyOf(post))) : listedPrevPaidRows, [listedPrevPaidRows, selectedCampaignIds]);

  // Fetches BOTH adset and ad level drill-down (Promise.allSettled, partial-
  // failure tolerant — same pattern Aquisição already used) whenever any
  // campaign is selected, independent of which table-level tab is active,
  // so the composite filter's "Conjunto" option list is always ready.
  const [adsetPostRows, setAdsetPostRows] = useState<MetaPost[]>([]);
  const [adPostRows, setAdPostRows] = useState<MetaPost[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState("");
  const selectedCampaignParents = useMemo(() => {
    const parents = new Map<string, { accountId: string; campaignId: string }>();
    for (const campaign of campaignsAll) {
      const key = `${campaign.accountId}:${campaign.campaignId}`;
      if (campaign.campaignId && selectedCampaignIds.includes(key)) parents.set(key, { accountId: campaign.accountId, campaignId: campaign.campaignId });
    }
    return [...parents.values()];
  }, [campaignsAll, selectedCampaignIds]);

  useEffect(() => {
    setAdsetPostRows([]);
    setAdPostRows([]);
    if (!selectedCampaignParents.length) { setDrillLoading(false); setDrillError(""); return; }
    const controller = new AbortController();
    setDrillLoading(true);
    setDrillError("");
    const requests = selectedCampaignParents.flatMap((parent) => (["adset", "ad"] as const).map(async (level) => {
      const params = new URLSearchParams({ account: parent.accountId, campaign: parent.campaignId, from: prevPeriodRange.from, to: period.to, level });
      const response = await fetch(`/api/admin/performance/insights/ads?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Falha ao carregar ${level === "adset" ? "conjuntos" : "criativos"}.`);
      return { level, rows: (body.rows ?? body.ads ?? []) as MetaPost[] };
    }));
    Promise.allSettled(requests).then((results) => {
      if (controller.signal.aborted) return;
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ level: "adset" | "ad"; rows: MetaPost[] }> => result.status === "fulfilled");
      setAdsetPostRows(fulfilled.filter((result) => result.value.level === "adset").flatMap((result) => result.value.rows));
      setAdPostRows(fulfilled.filter((result) => result.value.level === "ad").flatMap((result) => result.value.rows));
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length === results.length) setDrillError("Não foi possível carregar os detalhes das campanhas selecionadas.");
      else if (failures.length) setDrillError(`${failures.length} detalhe${failures.length === 1 ? "" : "s"} não puderam ser atualizados; os demais dados foram mantidos.`);
    }).finally(() => { if (!controller.signal.aborted) setDrillLoading(false); });
    return () => controller.abort();
  }, [selectedCampaignParents, prevPeriodRange.from, period.to]);

  // Bare adsetId/adId (not composite) — same convention performanceEntitySummaries
  // already uses for PerformanceEntitySummary.id and the shared table's row
  // checkboxes, so the composite filter's Conjunto checklist and the table's
  // selection stay the same id space (unlike campaign, adset ids aren't
  // known to collide across ad accounts in this codebase today).
  const adsetOptions = useMemo<ChecklistOption[]>(() => {
    const unique = new Map<string, ChecklistOption>();
    for (const post of adsetPostRows) if (post.adsetId) unique.set(post.adsetId, { key: post.adsetId, label: post.adsetName || post.caption || post.adsetId });
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [adsetPostRows]);

  const matchesAdsetSelection = useCallback((post: MetaPost) => !selectedAdsetIds.length || selectedAdsetIds.includes(post.adsetId ?? ""), [selectedAdsetIds]);

  const entityPostRows = entityLevel === "adset" ? adsetPostRows : entityLevel === "ad" ? adPostRows : [];
  const currentPaidRows = useMemo(() => {
    if (entityLevel === "campaign") return campaignCurrentPaidRows;
    return entityPostRows.filter((post) => inPeriod(post, period) && matchesAdsetSelection(post) && (entityLevel !== "ad" || !selectedAdIds.length || selectedAdIds.includes(post.adId ?? "")));
  }, [entityLevel, campaignCurrentPaidRows, entityPostRows, period, matchesAdsetSelection, selectedAdIds]);
  const prevPaidRows = useMemo(() => {
    if (entityLevel === "campaign") return campaignPrevPaidRows;
    return entityPostRows.filter((post) => inPeriod(post, prevPeriodRange) && matchesAdsetSelection(post) && (entityLevel !== "ad" || !selectedAdIds.length || selectedAdIds.includes(post.adId ?? "")));
  }, [entityLevel, campaignPrevPaidRows, entityPostRows, prevPeriodRange, matchesAdsetSelection, selectedAdIds]);

  const currentOrganicRows = useMemo(
    () => filterPosts(organicRows.filter((p) => inPeriod(p, period)), { platform: platformFilterValue || undefined }),
    [organicRows, period, platformFilterValue],
  );
  const prevOrganicRows = useMemo(
    () => filterPosts(organicRows.filter((p) => inPeriod(p, prevPeriodRange)), { platform: platformFilterValue || undefined }),
    [organicRows, prevPeriodRange, platformFilterValue],
  );

  const entitySummaries = useMemo<PerformanceEntitySummary[]>(() => {
    if (entityLevel === "campaign") return [];
    const rows = entityLevel === "adset" ? adsetPostRows : adPostRows;
    return performanceEntitySummaries(rows.filter((post) => inPeriod(post, period) && matchesAdsetSelection(post)), entityLevel);
  }, [entityLevel, adsetPostRows, adPostRows, period, matchesAdsetSelection]);

  const campaigns = useMemo(() => campaignsAll.slice(0, visibleCount), [campaignsAll, visibleCount]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [period.from, period.to, clientFilterValue, platformFilterValue]);

  const columns = useMemo(() => CAMPAIGN_METRIC_COLUMNS.filter((c) => visibleColumns.includes(c.key)), [visibleColumns]);

  function toggleCampaignSelection(compositeId: string) {
    if (!compositeId) return;
    setSelectedCampaignIds((current) => current.includes(compositeId) ? current.filter((id) => id !== compositeId) : [...current, compositeId]);
    markTemplateDirty();
  }
  function toggleAllCampaigns() {
    const ids = campaignsAll.filter((c) => c.campaignId).map((c) => `${c.accountId}:${c.campaignId}`);
    const allSelected = ids.length > 0 && ids.every((id) => selectedCampaignIds.includes(id));
    setSelectedCampaignIds(allSelected ? [] : ids);
    markTemplateDirty();
  }
  function changeEntityLevel(level: PerformanceEntityLevel) {
    setEntityLevel(level);
    markTemplateDirty();
  }
  function toggleEntitySelection(id: string) {
    const setter = entityLevel === "adset" ? setSelectedAdsetIds : setSelectedAdIds;
    setter((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    markTemplateDirty();
  }
  function toggleAllEntities() {
    const ids = entitySummaries.map((row) => row.id);
    const current = entityLevel === "adset" ? selectedAdsetIds : selectedAdIds;
    const setter = entityLevel === "adset" ? setSelectedAdsetIds : setSelectedAdIds;
    setter(ids.length > 0 && ids.every((id) => current.includes(id)) ? [] : ids);
    markTemplateDirty();
  }
  function clearEntitySelections() {
    setSelectedCampaignIds([]);
    setSelectedAdsetIds([]);
    setSelectedAdIds([]);
    markTemplateDirty();
  }
  function choosePreset(days: PeriodPreset) {
    setPreset(days);
    setCustomFrom("");
    setCustomTo("");
    markTemplateDirty();
  }
  function setCustomRange(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    markTemplateDirty();
  }
  function toggleSort(key: MetaPostMetricKey) {
    const nextDir: SortDir = sortKey === key && sortDir === "desc" ? "asc" : "desc";
    setSortKey(key);
    setSortDir(nextDir);
    markTemplateDirty();
  }
  function toggleColumn(key: MetaPostMetricKey) {
    setVisibleColumns((cols) => {
      const next = cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
      return CAMPAIGN_METRIC_COLUMNS.map((c) => c.key).filter((k) => next.includes(k));
    });
    markTemplateDirty();
  }
  function setAmbosCardSource(cardKey: string, source: "paid" | "organic") {
    setAmbosSource((m) => ({ ...m, [cardKey]: source }));
    markTemplateDirty();
  }

  function adCacheKey(c: CampaignSummary): string {
    return `${c.key}__${period.from}__${period.to}`;
  }
  const adRowsFor = useCallback((c: CampaignSummary) => adRows[adCacheKey(c)], [adRows, period.from, period.to]);

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
    const csvCell = (value: string) => (/[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
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

  // ---- Templates (Parte 5) ----
  const [templates, setTemplates] = useState<PerformanceTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [activeTemplateConfig, setActiveTemplateConfig] = useState<PerformanceTemplateConfig | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateSaveRequest, setTemplateSaveRequest] = useState(0);
  const templatesLoadedRef = useRef(false);

  const applyTemplate = useCallback((template: PerformanceTemplate) => {
    const config = sanitizePerformanceTemplateConfig(template.config);
    setPreset(config.prefs.defaultPeriod);
    setCustomFrom(config.dateRange?.from ?? "");
    setCustomTo(config.dateRange?.to ?? "");
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
    setSortKey(config.prefs.sortKey);
    setSortDir(config.prefs.sortDir);
    setVisibleColumns(config.prefs.visibleColumns);
    setAmbosSource(config.cardSources);
    // Visibilidade de seção da Aquisição é config do template (o PDF da
    // automação lê daqui). Analytics não é tocado — templates não guardam a
    // visibilidade das seções de Analytics.
    setHiddenSections((prev) => ({ ...prev, acquisition: new Set<string>(config.acquisition.hiddenSections) }));
    setActiveTemplateId(template.id);
    setActiveTemplateConfig(config);
    setTemplateDirty(false);
    setTemplateError("");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/performance/templates", { cache: "no-store" });
        if (!res.ok) throw new Error("Não foi possível carregar os templates.");
        const body = await res.json() as { templates: PerformanceTemplate[] };
        if (templatesLoadedRef.current) return;
        templatesLoadedRef.current = true;
        setTemplates(body.templates);
        if (body.templates[0]) applyTemplate(body.templates[0]);
      } catch {
        setTemplateError("Não foi possível carregar os templates; usando a visão padrão.");
      }
    })();
  }, [applyTemplate]);

  function requestTemplateSave() {
    setTemplateSaveRequest((value) => value + 1);
  }

  // Each screen owns its own per-card metric-slot config locally (kpiSlots
  // etc for Analytics, the equivalent for Aquisição — Parte 1's "local vs
  // shared" split) but a save must snapshot BOTH sides regardless of which
  // screen's save button was clicked (both screens are always mounted and
  // render the same composite filter/save UI against this one workspace).
  // Each dashboard reports its latest local prefs here via a small effect;
  // saving just reads the latest of both instead of requiring the caller
  // to thread them through as arguments.
  const [latestPrefs, setLatestPrefs] = useState<PerformanceTemplateConfig["prefs"]>(PERFORMANCE_VIEW_PREFS_DEFAULT);
  const [latestTrendMetrics, setLatestTrendMetrics] = useState<PerformanceTemplateConfig["trendMetrics"]>([PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric]);
  const [latestAcquisition, setLatestAcquisition] = useState<AcquisitionViewPrefs>(ACQUISITION_VIEW_PREFS_DEFAULT);

  function buildTemplateConfig(): PerformanceTemplateConfig {
    return sanitizePerformanceTemplateConfig({
      version: 1,
      prefs: { ...latestPrefs, visibleColumns, sortKey, sortDir, defaultPeriod: preset },
      acquisition: latestAcquisition,
      filters: { clientSlug: "", category, platforms: platformFilterValue ? [platformFilterValue] : [], objectives: objectiveFilterValues },
      dateRange: customRangeValid ? { from: customFrom, to: customTo } : null,
      cardSources: ambosSource,
      level: entityLevel,
      selectedCampaignIds,
      selectedAdsetIds,
      selectedAdIds,
      trendMetrics: latestTrendMetrics,
    });
  }

  async function saveTemplate(input: { name: string; overwrite: boolean }): Promise<boolean> {
    setTemplateSaving(true);
    setTemplateError("");
    try {
      const active = templates.find((template) => template.id === activeTemplateId);
      const overwrite = input.overwrite && Boolean(active) && active!.scope !== "builtin";
      const endpoint = overwrite ? `/api/admin/performance/templates/${active!.id}` : "/api/admin/performance/templates";
      const response = await fetch(endpoint, {
        method: overwrite ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name.trim(), description: active?.description || "Visão personalizada de Performance.", config: buildTemplateConfig() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o template.");
      const saved = body as PerformanceTemplate;
      setTemplates((current) => overwrite ? current.map((template) => template.id === saved.id ? saved : template) : [...current, saved]);
      setActiveTemplateId(saved.id);
      setActiveTemplateConfig(sanitizePerformanceTemplateConfig(saved.config));
      setTemplateDirty(false);
      return true;
    } catch (saveError) {
      setTemplateError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o template.");
      return false;
    } finally {
      setTemplateSaving(false);
    }
  }

  return {
    clients,
    canEdit,
    // period
    preset, customFrom, customTo, customRangeValid, period, prevPeriodRange, choosePreset, setCustomRange,
    // base fetch
    data, loading, error, load, paidConnected,
    paidRows, organicRows, platformOptions, objectiveOptions,
    // composite filter
    filters, changeFilters, clientFilterValue, category, platformFilterValue, objectiveFilterValues,
    campaignOptions, adsetOptions, selectedCampaignIds, selectedAdsetIds,
    onCampaignChange: setSelectedCampaignIds, onAdsetChange: setSelectedAdsetIds,
    adsetDisabled: selectedCampaignParents.length === 0 || drillLoading,
    // row sets
    listedCurrentPaidRows, listedPrevPaidRows,
    currentPaidRows, prevPaidRows, currentOrganicRows, prevOrganicRows,
    adsetPostRows, adPostRows,
    campaignsAll, campaigns, entitySummaries, columns,
    drillLoading, drillError,
    // shared bottom table / selection
    entityLevel, changeEntityLevel,
    toggleCampaignSelection, toggleAllCampaigns, toggleEntitySelection, toggleAllEntities, clearEntitySelections,
    sortKey, sortDir, toggleSort, visibleColumns, toggleColumn, columnsMenuOpen, setColumnsMenuOpen,
    selectedAdIds, adRowsFor, expanded, toggleExpand, exportCsv, visibleCount, setVisibleCount,
    // ambos toggle
    ambosSource, setAmbosCardSource,
    hiddenSections, toggleSectionVisibility,
    // templates
    templates, activeTemplateId, activeTemplateConfig, templateDirty, markTemplateDirty,
    templateSaving, templateError, templateSaveRequest, requestTemplateSave,
    applyTemplate, saveTemplate, setLatestPrefs, setLatestTrendMetrics, setLatestAcquisition,
  };
}

export type PerformanceWorkspace = ReturnType<typeof usePerformanceWorkspace>;
