"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MixDonut from "./charts/MixDonut";
import PostsBarChart from "./charts/PostsBarChart";
import TrendChart from "./charts/TrendChart";
import {
  adSummaries, campaignMetricValue, campaignSummaries, DASH_METRICS, engagementMix, filterPosts, fmtCompact,
  hasMetric, inPeriod, kpiSummaryFromSlots, metricLabel, previousPeriod, sortCampaigns, topCampaigns, trendSeries,
  type AdSummary, type CampaignSummary, type Period,
} from "./insights";
import {
  CAMPAIGN_METRIC_COLUMNS, PERFORMANCE_VIEW_PREFS_DEFAULT,
  type PeriodPreset, type PerformanceViewPrefs, type SortDir,
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

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presetPeriod(days: PeriodPreset): Period {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(today) };
}

// The insights route always fetches/caches a trailing 90-day window — a
// custom range starting earlier than that will come back empty.
function earliestCachedDay(): string {
  const today = new Date();
  return isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89));
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

export default function PerformanceDashboard({ clients, canEdit }: { clients: ClientLite[]; canEdit: boolean }) {
  const [preset, setPreset] = useState<PeriodPreset>(PERFORMANCE_VIEW_PREFS_DEFAULT.defaultPeriod);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [platform, setPlatform] = useState<"" | MetaPlatform>("");
  const [metric, setMetric] = useState<MetaPostMetricKey>("engajamento");
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

  const prefsAppliedRef = useRef(false);
  const pendingPrefsPatchRef = useRef<Partial<PerformanceViewPrefs>>({});
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const customRangeValid = Boolean(customFrom && customTo && customFrom <= customTo);
  const period = useMemo(
    () => (customRangeValid ? { from: customFrom, to: customTo } : presetPeriod(preset)),
    [customRangeValid, customFrom, customTo, preset],
  );
  const prevPeriodRange = useMemo(() => previousPeriod(period), [period]);

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
      if (clientFilter) params.set("client", clientFilter);
      if (refresh) params.set("refresh", "1");
      const res = await fetch(`/api/admin/performance/insights?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "");
      setData(body);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Não foi possível carregar os dados.");
    }
    setLoading(false);
  }, [prevPeriodRange.from, period.to, clientFilter]);

  useEffect(() => { void load(); }, [load]);

  const paidConnected = Boolean(data?.datasources.facebook) || Boolean(data?.datasources.meta_ads) || Boolean(data?.demo);
  const paidRows = useMemo(() => data?.posts.filter((p) => p.source === "paid") ?? [], [data]);
  const platformOptions = useMemo(
    () => [...new Set(paidRows.map((p) => p.platform))].sort((a, b) => PLATFORM_LABEL[a].localeCompare(PLATFORM_LABEL[b], "pt-BR")),
    [paidRows],
  );
  useEffect(() => {
    if (platform && !platformOptions.includes(platform)) setPlatform("");
  }, [platform, platformOptions]);

  const currentRows = useMemo(() => {
    const base = paidRows.filter((p) => inPeriod(p, period));
    return filterPosts(base, { platform: platform || undefined });
  }, [paidRows, period, platform]);

  const prevRows = useMemo(() => {
    const base = paidRows.filter((p) => inPeriod(p, prevPeriodRange));
    return filterPosts(base, { platform: platform || undefined });
  }, [paidRows, prevPeriodRange, platform]);

  const availableMetrics = useMemo(
    () => DASH_METRICS.filter((m) => hasMetric(currentRows, m.key)),
    [currentRows],
  );
  useEffect(() => {
    if (availableMetrics.length && !availableMetrics.some((m) => m.key === metric)) setMetric(availableMetrics[0].key);
  }, [availableMetrics, metric]);

  const kpis = useMemo(
    () => kpiSummaryFromSlots(currentRows, prevRows, PERFORMANCE_VIEW_PREFS_DEFAULT.kpiSlots, []),
    [currentRows, prevRows],
  );
  const trend = useMemo(() => trendSeries(currentRows, metric, period), [currentRows, metric, period]);
  const top = useMemo(() => topCampaigns(currentRows, metric, 8), [currentRows, metric]);
  const mix = useMemo(() => engagementMix(currentRows), [currentRows]);

  const campaignsAll = useMemo(
    () => sortCampaigns(campaignSummaries(currentRows), sortKey, sortDir),
    [currentRows, sortKey, sortDir],
  );
  const campaigns = useMemo(() => campaignsAll.slice(0, visibleCount), [campaignsAll, visibleCount]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [period.from, period.to, clientFilter, platform]);

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

  function clearCustomRange() {
    setCustomFrom("");
    setCustomTo("");
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

  return (
    <div className="perf-dash">
      <div className="perf-filters">
        <div className="kb-modetoggle">
          {([7, 30, 90] as PeriodPreset[]).map((d) => (
            <button key={d} className={!customRangeValid && preset === d ? "on" : ""} onClick={() => choosePreset(d)}>{d} dias</button>
          ))}
        </div>
        <div className="perf-daterange">
          <input type="date" aria-label="Período customizado: de" value={customFrom} min={earliestCachedDay()} max={isoDay(new Date())} onChange={(e) => setCustomFrom(e.target.value)} />
          <span>até</span>
          <input type="date" aria-label="Período customizado: até" value={customTo} min={customFrom || earliestCachedDay()} max={isoDay(new Date())} onChange={(e) => setCustomTo(e.target.value)} />
          {customRangeValid ? <button className="admin-btn ghost small" onClick={clearCustomRange}>Limpar</button> : null}
        </div>
        <select className="perf-select" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <div className="kb-modetoggle" aria-label="Filtrar anúncios por plataforma">
          <button className={platform === "" ? "on" : ""} onClick={() => setPlatform("")}>Todas</button>
          {platformOptions.map((item) => (
            <button key={item} className={platform === item ? "on" : ""} onClick={() => setPlatform(item)}>
              {PLATFORM_LABEL[item]}
            </button>
          ))}
        </div>
        <span className={`kb-loadspin ${loading ? "on" : ""}`} role="status" aria-hidden={!loading} />
        <div className="kb-spacer" />
        <span className="perf-source-chip">Meta Ads</span>
        {data?.demo ? <span className="perf-demo-chip">Dados de demonstração</span> : null}
        {data?.stale ? <span className="perf-demo-chip perf-stale-chip" title={data.error}>Dados desatualizados</span> : null}
        <button className="admin-btn ghost" onClick={() => void load(true)} disabled={loading || Boolean(data?.demo)}>
          Atualizar dados
        </button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}
      {!loading && !error && !paidConnected ? <p className="admin-error">Conecte uma conta Meta Ads para carregar dados pagos reais.</p> : null}

      <div className="perf-kpis">
        {kpis.map((k) => {
          const available = k.available;
          return (
            <div className="perf-kpi" key={k.metric}>
              <span className="perf-kpi-label">{k.label}</span>
              <strong className="perf-kpi-value">
                {available ? metricValue(k.value, k.metric === "custo" ? "money" : "number", currentRows[0]?.currency) : "—"}
              </strong>
              {available && k.delta !== null ? (
                <span className={`perf-kpi-delta ${k.delta >= 0 ? "up" : "down"}`}>
                  {k.delta >= 0 ? "▲" : "▼"} {Math.abs(k.delta)}% vs período anterior
                </span>
              ) : (
                <span className="perf-kpi-delta muted">— sem comparação disponível</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="perf-card perf-trend">
        <div className="perf-card-head">
          <div><h3>Tendência diária dos anúncios</h3><p className="perf-card-sub">Somente dados pagos retornados pela Meta.</p></div>
          <div className="perf-metric-pills">
            {availableMetrics.map((m) => (
              <button key={m.key} className={`kb-chip ${metric === m.key ? "on" : ""}`} onClick={() => setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <TrendChart data={trend} label={metricLabel(metric)} />
      </div>

      <div className="perf-two-up">
        <div className="perf-card">
          <div className="perf-card-head"><h3>Top campanhas · {metricLabel(metric)}</h3></div>
          {top.length ? <PostsBarChart posts={top.map((c) => ({ key: c.key, caption: c.caption, platform: c.platform, value: campaignMetricValue(c, metric, []) }))} label={metricLabel(metric)} /> : <p className="perf-empty">Sem campanhas com essa métrica no período.</p>}
        </div>
        <div className="perf-card">
          <div className="perf-card-head"><h3>Engajamento dos anúncios</h3></div>
          {mix.length ? <MixDonut slices={mix} /> : <p className="perf-empty">A Meta não retornou interações no período.</p>}
        </div>
      </div>

      <div className="perf-card">
        <div className="perf-card-head">
          <div><h3>Campanhas</h3><p className="perf-card-sub">{campaignsAll.length} campanha{campaignsAll.length === 1 ? "" : "s"} por plataforma no período</p></div>
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
    </div>
  );
}
