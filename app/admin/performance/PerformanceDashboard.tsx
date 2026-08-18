"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MixDonut from "./charts/MixDonut";
import PostsBarChart from "./charts/PostsBarChart";
import TrendChart from "./charts/TrendChart";
import {
  DASH_METRICS, engagementMix, filterPosts, fmtCompact, inPeriod, kpiSummary,
  metricLabel, previousPeriod, topCampaigns, topPosts, trendSeries, type Period,
} from "./insights";
import type { MetaPost, MetaPostMetricKey, MetaPostType, WindsorDatasource } from "@/lib/windsor";

type ClientLite = { slug: string; name: string };
type PeriodPreset = 7 | 30 | 90;
type InsightsResponse = {
  demo: boolean;
  stale: boolean;
  error?: string;
  posts: MetaPost[];
  datasources: Partial<Record<WindsorDatasource | "meta_ads", boolean>>;
  fetchedAt: string | null;
};

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presetPeriod(days: PeriodPreset): Period {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(today) };
}

const TYPE_LABEL: Record<MetaPostType, string> = {
  reel: "Reel", carrossel: "Carrossel", imagem: "Imagem", video: "Vídeo", story: "Story", outro: "Outro",
};

// The analytics view of the Performance screen: KPIs with period-over-period
// deltas, a daily trend, top-posts comparison, engagement mix and a sortable
// ranking — all computed client-side (insights.ts) from one insights fetch
// that covers the period AND its preceding twin (for deltas).
export default function PerformanceDashboard({ clients }: { clients: ClientLite[] }) {
  const [preset, setPreset] = useState<PeriodPreset>(30);
  const [clientFilter, setClientFilter] = useState("");
  const [platform, setPlatform] = useState<"" | "instagram" | "facebook">("");
  const [mediaType, setMediaType] = useState<"" | MetaPostType>("");
  const [metric, setMetric] = useState<MetaPostMetricKey>("alcance");
  const [rankDir, setRankDir] = useState<"top" | "bottom">("top");
  const [sortKey, setSortKey] = useState<MetaPostMetricKey>("alcance");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const period = useMemo(() => presetPeriod(preset), [preset]);
  const prevPeriodRange = useMemo(() => previousPeriod(period), [period]);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      // One call wide enough for current + previous period; split client-side.
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

  const paid = Boolean(data?.datasources.facebook) || Boolean(data?.datasources.meta_ads) || Boolean(data?.demo);
  const availableMetrics = DASH_METRICS.filter((m) => paid || !m.paidOnly);

  const currentPosts = useMemo(() => {
    if (!data) return [];
    const base = data.posts.filter((p) => inPeriod(p, period));
    return filterPosts(base, {
      platform: platform || undefined,
      type: mediaType || undefined,
    });
  }, [data, period, platform, mediaType]);

  const prevPosts = useMemo(() => {
    if (!data) return [];
    const base = data.posts.filter((p) => inPeriod(p, prevPeriodRange));
    return filterPosts(base, { platform: platform || undefined, type: mediaType || undefined });
  }, [data, prevPeriodRange, platform, mediaType]);

  const kpis = useMemo(() => kpiSummary(currentPosts, prevPosts, paid), [currentPosts, prevPosts, paid]);
  const trend = useMemo(() => trendSeries(currentPosts, metric, period), [currentPosts, metric, period]);
  const top = useMemo(() => topPosts(currentPosts, metric, 8, "top"), [currentPosts, metric]);
  const mix = useMemo(() => engagementMix(currentPosts), [currentPosts]);
  const ranked = useMemo(() => topPosts(currentPosts, sortKey, 20, rankDir), [currentPosts, sortKey, rankDir]);
  const campaigns = useMemo(() => topCampaigns(currentPosts, "custo", 20), [currentPosts]);

  const fmtDate = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(d)}/${Number(m)}`;
  };

  return (
    <div className="perf-dash">
      <div className="perf-filters">
        <div className="kb-modetoggle">
          {([7, 30, 90] as PeriodPreset[]).map((d) => (
            <button key={d} className={preset === d ? "on" : ""} onClick={() => setPreset(d)}>{d} dias</button>
          ))}
        </div>
        <select className="perf-select" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <div className="kb-modetoggle">
          <button className={platform === "" ? "on" : ""} onClick={() => setPlatform("")}>Todas</button>
          <button className={platform === "instagram" ? "on" : ""} onClick={() => setPlatform("instagram")}>Instagram</button>
          <button className={platform === "facebook" ? "on" : ""} onClick={() => setPlatform("facebook")}>Facebook</button>
        </div>
        <select className="perf-select" value={mediaType} onChange={(e) => setMediaType(e.target.value as "" | MetaPostType)}>
          <option value="">Todos os formatos</option>
          {(Object.keys(TYPE_LABEL) as MetaPostType[]).filter((t) => t !== "outro").map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <span className={`kb-loadspin ${loading ? "on" : ""}`} role="status" aria-hidden={!loading} />
        <div className="kb-spacer" />
        {data?.demo ? <span className="perf-demo-chip">Dados de demonstração</span> : null}
        {data?.stale ? <span className="perf-demo-chip perf-stale-chip" title={data.error}>Dados desatualizados</span> : null}
        <button className="admin-btn ghost" onClick={() => void load(true)} disabled={loading || Boolean(data?.demo)}>
          Atualizar dados
        </button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="perf-kpis">
        {kpis.map((k) => (
          <div className="perf-kpi" key={k.key}>
            <span className="perf-kpi-label">{k.label}</span>
            <strong className="perf-kpi-value">{k.key === "custo" ? `R$ ${fmtCompact(k.value)}` : fmtCompact(k.value)}</strong>
            {k.delta !== null ? (
              <span className={`perf-kpi-delta ${k.delta >= 0 ? "up" : "down"}`}>
                {k.delta >= 0 ? "▲" : "▼"} {Math.abs(k.delta)}% vs período anterior
              </span>
            ) : (
              <span className="perf-kpi-delta muted">— sem período anterior</span>
            )}
          </div>
        ))}
      </div>

      <div className="perf-card perf-trend">
        <div className="perf-card-head">
          <h3>Tendência diária</h3>
          <div className="perf-metric-pills">
            {availableMetrics.map((m) => (
              <button
                key={m.key}
                className={`kb-chip ${metric === m.key ? "on" : ""}`}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <TrendChart data={trend} label={metricLabel(metric)} />
      </div>

      <div className="perf-two-up">
        <div className="perf-card">
          <div className="perf-card-head"><h3>Top posts · {metricLabel(metric)}</h3></div>
          {top.length ? (
            <PostsBarChart posts={top} metric={metric} label={metricLabel(metric)} />
          ) : (
            <p className="perf-empty">Nenhum post orgânico no período.</p>
          )}
        </div>
        <div className="perf-card">
          <div className="perf-card-head"><h3>Mix de engajamento</h3></div>
          {mix.length ? <MixDonut slices={mix} /> : <p className="perf-empty">Sem interações no período.</p>}
        </div>
      </div>

      {paid ? (
        <div className="perf-card">
          <div className="perf-card-head"><h3>Campanhas</h3></div>
          <div className="admin-table-wrap perf-table-wrap">
            <table className="admin-table perf-table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Campanha</th>
                  <th>Impressões</th>
                  <th>Cliques</th>
                  <th>CTR</th>
                  <th>CPC</th>
                  <th>Custo</th>
                  <th>Conversões</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.key}>
                    <td className="admin-cell-muted">{c.accountName}</td>
                    <td className="perf-td-caption">{c.caption || "—"}</td>
                    <td>{fmtCompact(c.metrics.impressoes ?? 0)}</td>
                    <td>{fmtCompact(c.metrics.cliques ?? 0)}</td>
                    <td>{c.metrics.ctr !== undefined ? `${c.metrics.ctr.toLocaleString("pt-BR")}%` : "—"}</td>
                    <td>{c.metrics.cpc !== undefined ? `R$ ${fmtCompact(c.metrics.cpc)}` : "—"}</td>
                    <td>{c.metrics.custo !== undefined ? `R$ ${fmtCompact(c.metrics.custo)}` : "—"}</td>
                    <td>{fmtCompact(c.metrics.conversoes ?? 0)}</td>
                  </tr>
                ))}
                {campaigns.length === 0 ? (
                  <tr><td colSpan={8} className="perf-empty">Nenhuma campanha com dados pagos no período.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="perf-card">
        <div className="perf-card-head">
          <h3>Ranking de posts</h3>
          <div className="kb-modetoggle">
            <button className={rankDir === "top" ? "on" : ""} onClick={() => setRankDir("top")}>Melhores</button>
            <button className={rankDir === "bottom" ? "on" : ""} onClick={() => setRankDir("bottom")}>Piores</button>
          </div>
        </div>
        <div className="admin-table-wrap perf-table-wrap">
          <table className="admin-table perf-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Plataforma</th>
                <th>Formato</th>
                <th>Post</th>
                {(["alcance", "impressoes", "engajamento"] as MetaPostMetricKey[]).map((k) => (
                  <th key={k} className="perf-th-sort" onClick={() => setSortKey(k)} aria-sort={sortKey === k ? "descending" : "none"}>
                    {metricLabel(k)}{sortKey === k ? " ↓" : ""}
                  </th>
                ))}
                {paid ? (
                  <th className="perf-th-sort" onClick={() => setSortKey("custo")} aria-sort={sortKey === "custo" ? "descending" : "none"}>
                    Custo{sortKey === "custo" ? " ↓" : ""}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {ranked.map((p) => (
                <tr
                  key={p.id}
                  className={p.permalink ? "perf-row-link" : ""}
                  onClick={() => { if (p.permalink) window.open(p.permalink, "_blank", "noopener"); }}
                >
                  <td className="admin-cell-muted">{fmtDate(p.date)}</td>
                  <td>
                    <span className={`kb-type ${p.platform === "instagram" ? "t-tone-purple" : "t-tone-blue"}`}>
                      {p.platform === "instagram" ? "Instagram" : "Facebook"}
                    </span>
                  </td>
                  <td className="admin-cell-muted">{TYPE_LABEL[p.type]}</td>
                  <td className="perf-td-caption">{p.caption || "—"}</td>
                  <td>{fmtCompact(p.metrics.alcance ?? 0)}</td>
                  <td>{fmtCompact(p.metrics.impressoes ?? 0)}</td>
                  <td>{fmtCompact(p.metrics.engajamento ?? 0)}</td>
                  {paid ? <td>{p.metrics.custo !== undefined ? `R$ ${fmtCompact(p.metrics.custo)}` : "—"}</td> : null}
                </tr>
              ))}
              {ranked.length === 0 ? (
                <tr><td colSpan={paid ? 8 : 7} className="perf-empty">Nenhum post no período com os filtros atuais.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
