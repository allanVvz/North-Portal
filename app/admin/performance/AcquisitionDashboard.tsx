"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MetaPost } from "@/lib/windsor";
import DateRangeField from "../DateRangeField";
import AcquisitionTrendChart from "./charts/AcquisitionTrendChart";
import {
  acquisitionDailySeries,
  creativePerformanceRows,
  summarizeAcquisition,
  type AcquisitionSummary,
  type NullableMetric,
} from "./acquisitionInsights";

type Period = { from: string; to: string };
type CampaignOption = { key: string; id: string; accountId: string; label: string };
type ChecklistOption = { key: string; label: string };

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function initialPeriod(): Period {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 29);
  return { from: isoDay(from), to: isoDay(to) };
}

function preceding(period: Period): Period {
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const prevFrom = new Date(prevTo.getFullYear(), prevTo.getMonth(), prevTo.getDate() - days + 1);
  return { from: isoDay(prevFrom), to: isoDay(prevTo) };
}

function inPeriod(post: MetaPost, period: Period) {
  return post.date >= period.from && post.date <= period.to;
}

function format(value: NullableMetric, kind: "number" | "money" | "percent" = "number") {
  if (value === null) return "—";
  if (kind === "money") return money.format(value);
  if (kind === "percent") return `${decimal.format(value)}%`;
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

function Gauge({ label, current, previous, kind, inverse = false }: { label: string; current: NullableMetric; previous: NullableMetric; kind: "money" | "percent"; inverse?: boolean }) {
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

function Kpi({ label, value, previous, kind, hint, inverse = false }: { label: string; value: NullableMetric; previous: NullableMetric; kind?: "number" | "money" | "percent"; hint?: string; inverse?: boolean }) {
  return (
    <article className="acq-kpi">
      <span>{label}</span>
      <strong>{format(value, kind)}</strong>
      <Delta current={value} previous={previous} inverse={inverse} />
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function AcquisitionCompositeFilter({ campaignOptions, adsetOptions, campaignSelected, adsetSelected, onCampaignChange, onAdsetChange, adsetDisabled }: {
  campaignOptions: ChecklistOption[];
  adsetOptions: ChecklistOption[];
  campaignSelected: string[];
  adsetSelected: string[];
  onCampaignChange: (next: string[]) => void;
  onAdsetChange: (next: string[]) => void;
  adsetDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<"campaign" | "adset" | null>(null);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setPendingAttr(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setPendingAttr(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const options = pendingAttr === "campaign" ? campaignOptions : pendingAttr === "adset" ? adsetOptions : [];
  const selected = pendingAttr === "campaign" ? campaignSelected : pendingAttr === "adset" ? adsetSelected : [];
  const onChange = pendingAttr === "campaign" ? onCampaignChange : onAdsetChange;
  const visible = options.filter((option) => option.label.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  const chipLabel = (items: string[], source: ChecklistOption[], plural: string) => items.length === 1
    ? source.find((option) => option.key === items[0])?.label ?? "1 selecionado"
    : `${items.length} ${plural}`;
  const openMenu = () => setOpen(true);
  return (
    <div className="kb-searchbar perf-filterbar perf-analysis-filterbar acq-composite-filter" ref={root}>
      <div
        className="kb-searchbar-box"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openMenu}
        onKeyDown={(event) => {
          if (event.currentTarget !== event.target || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          openMenu();
        }}
      >
        {campaignSelected.length ? <span className="kb-filterchip"><b>Campanha:</b> {chipLabel(campaignSelected, campaignOptions, "selecionadas")}<button type="button" aria-label="Limpar campanhas" onClick={(event) => { event.stopPropagation(); onCampaignChange([]); }}>✕</button></span> : null}
        {adsetSelected.length ? <span className="kb-filterchip"><b>Conjunto:</b> {chipLabel(adsetSelected, adsetOptions, "selecionados")}<button type="button" aria-label="Limpar conjuntos de anúncios" onClick={(event) => { event.stopPropagation(); onAdsetChange([]); }}>✕</button></span> : null}
        {!campaignSelected.length && !adsetSelected.length ? <span className="doc-filterbar-placeholder">Campanha ou conjunto de anúncios…</span> : null}
        <button type="button" className="acq-composite-open" aria-label="Abrir filtros de campanha e conjunto" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}>⌄</button>
      </div>
      {open ? <div className="kb-searchbar-panel acq-composite-panel" role="dialog" aria-label="Filtros de campanha e conjunto de anúncios">
        {pendingAttr ? <>
          <div className="kb-searchbar-panelhead">
            <button type="button" className="kb-searchbar-back" onClick={() => { setPendingAttr(null); setQuery(""); }}>‹ Voltar</button>
            <span>{pendingAttr === "campaign" ? "Campanha" : "Conjunto de anúncios"}</span>
          </div>
          <input className="acq-filter-search" autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar ${pendingAttr === "campaign" ? "campanha" : "conjunto"}…`} aria-label={`Buscar ${pendingAttr === "campaign" ? "Campanha" : "Conjunto de anúncios"}`} />
          <div className="acq-filter-options">
            <label className="acq-filter-option"><input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} /><span>{pendingAttr === "campaign" ? "Todas as campanhas" : "Todos os conjuntos"}</span></label>
            {visible.map((option) => <label className="acq-filter-option" key={option.key}><input type="checkbox" checked={selected.includes(option.key)} onChange={() => toggle(option.key)} /><span>{option.label}</span></label>)}
            {!visible.length ? <div className="acq-filter-empty">Nenhum resultado.</div> : null}
          </div>
        </> : <>
          <div className="kb-searchbar-panelhead"><span>Filtrar por atributo</span></div>
          <div className="kb-searchbar-attrlist">
            <button type="button" className="kb-searchbar-attr" onClick={() => { setPendingAttr("campaign"); setQuery(""); }}><span aria-hidden>◫</span>Campanha</button>
            <button type="button" className="kb-searchbar-attr" disabled={adsetDisabled} onClick={() => { setPendingAttr("adset"); setQuery(""); }}><span aria-hidden>▦</span>Conjunto de anúncios{adsetDisabled ? <small>{campaignSelected.length ? "Carregando…" : "Selecione uma campanha"}</small> : null}</button>
          </div>
        </>}
      </div> : null}
    </div>
  );
}

export default function AcquisitionDashboard() {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [posts, setPosts] = useState<MetaPost[]>([]);
  const [adsetPosts, setAdsetPosts] = useState<MetaPost[]>([]);
  const [adPosts, setAdPosts] = useState<MetaPost[]>([]);
  const [campaignKeys, setCampaignKeys] = useState<string[]>([]);
  const [adsetKeys, setAdsetKeys] = useState<string[]>([]);
  const [activePreset, setActivePreset] = useState<number | null>(30);
  const [loading, setLoading] = useState(true);
  const [drillLoading, setDrillLoading] = useState(false);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const previousPeriod = useMemo(() => preceding(period), [period]);

  const campaigns = useMemo<CampaignOption[]>(() => {
    const unique = new Map<string, CampaignOption>();
    for (const post of posts) {
      if (post.source !== "paid" || !post.campaignId) continue;
      const key = `${post.accountId}:${post.campaignId}`;
      if (!unique.has(key)) unique.set(key, { key, id: post.campaignId, accountId: post.accountId, label: post.campaignName || post.caption || post.campaignId });
    }
    return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [posts]);
  const selectedCampaigns = useMemo(() => campaigns.filter((item) => campaignKeys.includes(item.key)), [campaignKeys, campaigns]);

  const fetchBase = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from: previousPeriod.from, to: period.to });
      if (refresh) params.set("refresh", "1");
      const response = await fetch(`/api/admin/performance/insights?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar os dados de aquisição.");
      setPosts(Array.isArray(body.posts) ? body.posts : []);
      setDemo(Boolean(body.demo));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados de aquisição.");
    } finally {
      setLoading(false);
    }
  }, [period.to, previousPeriod.from]);

  useEffect(() => { void fetchBase(); }, [fetchBase]);

  useEffect(() => {
    setAdsetKeys([]);
    setAdsetPosts([]);
    setAdPosts([]);
    if (!selectedCampaigns.length || demo) {
      setDrillLoading(false);
      return;
    }
    const controller = new AbortController();
    setError("");
    setDrillLoading(true);
    const requests = selectedCampaigns.flatMap((campaign) => (["adset", "ad"] as const).map(async (level) => {
      const query = new URLSearchParams({ account: campaign.accountId, campaign: campaign.id, from: previousPeriod.from, to: period.to, level });
      const response = await fetch(`/api/admin/performance/insights/ads?${query}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Falha ao carregar ${level === "adset" ? "conjuntos" : "criativos"}.`);
      return { level, rows: Array.isArray(body.rows) ? body.rows as MetaPost[] : [] };
    }));
    Promise.allSettled(requests).then((results) => {
      if (controller.signal.aborted) return;
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ level: "adset" | "ad"; rows: MetaPost[] }> => result.status === "fulfilled");
      setAdsetPosts(fulfilled.filter((result) => result.value.level === "adset").flatMap((result) => result.value.rows));
      setAdPosts(fulfilled.filter((result) => result.value.level === "ad").flatMap((result) => result.value.rows));
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length === results.length) setError("Não foi possível abrir os detalhes das campanhas selecionadas.");
      else if (failures.length) setError(`${failures.length} detalhe${failures.length === 1 ? "" : "s"} não puderam ser atualizados; os demais dados foram mantidos.`);
    }).finally(() => { if (!controller.signal.aborted) setDrillLoading(false); });
    return () => controller.abort();
  }, [demo, period.to, previousPeriod.from, selectedCampaigns]);

  const adsets = useMemo(() => {
    const unique = new Map<string, ChecklistOption>();
    for (const post of adsetPosts) if (post.adsetId && post.campaignId) {
      const key = `${post.accountId}:${post.campaignId}:${post.adsetId}`;
      unique.set(key, { key, label: post.adsetName || post.caption || post.adsetId });
    }
    return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [adsetPosts]);

  const selectedSource = adsetKeys.length ? adsetPosts : posts;
  const matchesSelections = useCallback((post: MetaPost) => {
    if (post.source !== "paid") return false;
    const campaignKey = `${post.accountId}:${post.campaignId ?? ""}`;
    if (campaignKeys.length && !campaignKeys.includes(campaignKey)) return false;
    const adsetKey = `${campaignKey}:${post.adsetId ?? ""}`;
    return !adsetKeys.length || adsetKeys.includes(adsetKey);
  }, [adsetKeys, campaignKeys]);
  const currentPosts = useMemo(() => selectedSource.filter((post) => matchesSelections(post) && inPeriod(post, period)), [matchesSelections, period, selectedSource]);
  const previousPosts = useMemo(() => selectedSource.filter((post) => matchesSelections(post) && inPeriod(post, previousPeriod)), [matchesSelections, previousPeriod, selectedSource]);
  const current = useMemo(() => summarizeAcquisition(currentPosts), [currentPosts]);
  const previous = useMemo(() => summarizeAcquisition(previousPosts), [previousPosts]);
  const trend = useMemo(() => acquisitionDailySeries(currentPosts, period.from, period.to), [currentPosts, period]);
  const creativeRows = useMemo(() => creativePerformanceRows(adPosts.filter((post) => matchesSelections(post) && inPeriod(post, period))), [adPosts, matchesSelections, period]);

  const choosePreset = (days: number) => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - days + 1);
    setPeriod({ from: isoDay(from), to: isoDay(to) });
    setActivePreset(days);
  };

  return (
    <div className="acq-dashboard" data-testid="acquisition-dashboard">
      <div className="perf-analysis-toolbar acq-toolbar" aria-label="Filtros do dashboard de aquisição">
        <DateRangeField from={period.from} to={period.to} onChange={(from, to) => { setPeriod({ from, to }); setActivePreset(null); }} presets={[7, 30, 90]} activePreset={activePreset} onPreset={choosePreset} />
        <AcquisitionCompositeFilter
          campaignOptions={campaigns.map(({ key, label }) => ({ key, label }))}
          adsetOptions={adsets}
          campaignSelected={campaignKeys}
          adsetSelected={adsetKeys}
          onCampaignChange={setCampaignKeys}
          onAdsetChange={setAdsetKeys}
          adsetDisabled={!selectedCampaigns.length || drillLoading || demo}
        />
        <button className={`perf-toolbar-icon perf-refresh${loading ? " is-loading" : ""}`} type="button" onClick={() => void fetchBase(true)} disabled={loading} aria-label={loading ? "Atualizando dados" : "Atualizar dados"} title="Atualizar dados">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M19 7v5h-5M5 17v-5h5M18 11a7 7 0 0 0-12-3L5 9m1 4a7 7 0 0 0 12 3l1-1" /></svg>
        </button>
      </div>

      {error ? <div className="acq-alert" role="alert">{error}</div> : null}
      {demo ? <div className="acq-demo-note">Dados demonstrativos · conecte uma conta Meta para abrir conjuntos e criativos reais.</div> : null}

      <section className="acq-kpi-grid" aria-label="KPIs principais">
        <Kpi label="Investimento" value={current.spend} previous={previous.spend} kind="money" />
        <Kpi label="Oportunidades" value={current.opportunities} previous={previous.opportunities} hint="Leads informados pela Meta" />
        <Kpi label="Custo por lead" value={current.costPerLead} previous={previous.costPerLead} kind="money" inverse />
      </section>

      <div className="acq-main-grid">
        <aside className="acq-volume-panel">
          <div className="acq-section-head"><div><span>Volume</span><h2>Entrada do funil</h2></div></div>
          <Kpi label="Impressões" value={current.impressions} previous={previous.impressions} />
          <Kpi label="Cliques" value={current.clicks} previous={previous.clicks} />
          <Kpi label="Taxa de conversão" value={current.conversionRate} previous={previous.conversionRate} kind="percent" hint="Leads ÷ cliques" />
        </aside>

        <section className="acq-chart-panel">
          <div className="acq-section-head"><div><span>Evolução</span><h2>Investimento x mensagens</h2></div><small>Linhas independentes · mesmo período</small></div>
          {loading ? <div className="acq-loading">Carregando série…</div> : <AcquisitionTrendChart data={trend} />}
        </section>

      </div>

      <section className="acq-gauges" aria-label="Indicadores de mídia">
        <div className="acq-section-head"><div><span>Eficiência de mídia</span><h2>Custos e taxa de clique</h2></div><small>Arco: atual em relação ao período anterior</small></div>
        <div className="acq-gauge-grid">
          <Gauge label="CPM" current={current.cpm} previous={previous.cpm} kind="money" inverse />
          <Gauge label="CPC" current={current.cpc} previous={previous.cpc} kind="money" inverse />
          <Gauge label="CTR" current={current.ctr} previous={previous.ctr} kind="percent" />
        </div>
      </section>

      <div className="acq-lower-grid">
        <section className="acq-conversion-panel">
          <div className="acq-section-head"><div><span>Conversão e intenção</span><h2>Funil de aquisição</h2></div><small>Alcance → clique → lead → CPA · mensagens em paralelo</small></div>
          <ConversionFunnel summary={current} />
        </section>

        <section className="acq-creative-panel">
          <div className="acq-section-head"><div><span>Diagnóstico</span><h2>Performance por criativo</h2></div><small>{creativeRows.length ? `${creativeRows.length} criativo${creativeRows.length === 1 ? "" : "s"}` : "Detalhe por anúncio"}</small></div>
          <CreativeTable rows={creativeRows} campaignSelected={Boolean(selectedCampaigns.length)} loading={drillLoading} demo={demo} />
        </section>
      </div>
    </div>
  );
}

function ConversionFunnel({ summary }: { summary: AcquisitionSummary }) {
  const stages = [
    { label: "Alcance", value: summary.reach },
    { label: "Cliques", value: summary.clicks },
    { label: "Leads", value: summary.opportunities },
  ];
  const stageRates = [
    ratioLabel(summary.clicks, summary.reach),
    ratioLabel(summary.opportunities, summary.clicks),
  ];
  return (
    <div className="acq-conversion-flow">
      <div className="acq-object-wrap">
        <Image src="/images/performance/acquisition-funnel.png" alt="Funil abstrato roxo, largo no topo e estreito na base" width={360} height={360} priority={false} />
      </div>
      <div className="acq-flow-stages">
        {stages.map((stage, index) => <div className="acq-flow-item" key={stage.label}>
          <div className={`acq-flow-stage ${stage.value === null ? "missing" : ""}`}><span>{stage.label}</span><strong>{format(stage.value)}</strong></div>
          {index < stages.length - 1 ? <div className="acq-flow-arrow" aria-label={`${stageRates[index]} para a próxima etapa`}><b aria-hidden>→</b><small>{stageRates[index]}</small></div> : null}
        </div>)}
      </div>
      <div className="acq-funnel-terminal"><span>CPA</span><strong>{format(summary.costPerLead, "money")}</strong><small>investimento ÷ leads</small></div>
      <div className="acq-message-branch" aria-label="Mensagens iniciadas como ramificação paralela dos cliques">
        <div className="acq-message-rate">
          <strong>{format(summary.clickToMessageRate, "percent")}</strong>
          <span>{summary.messageClickBasis === "link" ? "dos cliques no link" : "dos cliques totais"}</span>
        </div>
        <span className="acq-message-branch-arrow" aria-hidden>↘</span>
        <div className="acq-message-branch-value"><span>Mensagens iniciadas</span><strong>{format(summary.messages)}</strong><small>ramificação de intenção</small></div>
      </div>
    </div>
  );
}

function ratioLabel(numerator: NullableMetric, denominator: NullableMetric) {
  if (numerator === null || denominator === null || denominator === 0) return "—";
  return `${decimal.format((numerator / denominator) * 100)}%`;
}

function CreativeTable({ rows, campaignSelected, loading, demo }: { rows: ReturnType<typeof creativePerformanceRows>; campaignSelected: boolean; loading: boolean; demo: boolean }) {
  if (loading) return <div className="acq-table-empty">Carregando criativos…</div>;
  if (!campaignSelected) return <div className="acq-table-empty">Selecione uma campanha para comparar os criativos.</div>;
  if (demo) return <div className="acq-table-empty">O detalhe por criativo fica disponível com uma conta Meta conectada.</div>;
  if (!rows.length) return <div className="acq-table-empty">Nenhum criativo com dados neste período.</div>;
  return (
    <div className="acq-table-wrap">
      <table className="acq-table"><thead><tr><th>Criativo</th><th>Cliques</th><th>Leads</th><th>CPA</th><th>CTR</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td><div className="acq-creative-name">{row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" /> : <span className="acq-thumb-placeholder">AD</span>}<span title={row.name}>{row.name}</span></div></td><td>{format(row.clicks)}</td><td>{format(row.leads)}</td><td>{format(row.cpa, "money")}</td><td>{format(row.ctr, "percent")}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
