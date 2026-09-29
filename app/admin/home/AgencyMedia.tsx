"use client";

import Link from "next/link";
import type { ClientInsight } from "@/lib/insights/clientInsights";
import Sparkline from "./Sparkline";
import { compact, delta, money } from "./useInsights";

// Mídia da agência (29/09): a última semana fechada somando todos os clientes,
// com a tendência de 8 semanas. Os números vêm dos relatórios de anúncios
// (traffic_reports), com as mesmas contas dos PDFs.

export default function AgencyMedia({ insights }: { insights: ClientInsight[] | null }) {
  if (!insights) return <div className="admin-card agency-media is-loading"><p className="admin-hint">Carregando a mídia da semana…</p></div>;
  const weeks = [...new Set(insights.flatMap((client) => client.media.map((week) => week.periodTo)))].sort();
  if (!weeks.length) return null;
  const sum = (periodTo: string, pick: (week: ClientInsight["media"][number]) => number | null) => {
    let total = 0; let any = false;
    for (const client of insights) { const week = client.media.find((row) => row.periodTo === periodTo); const value = week ? pick(week) : null; if (value !== null) { total += value; any = true; } }
    return any ? total : null;
  };
  const gain = (periodTo: string) => {
    let total = 0; let any = false;
    for (const client of insights) { const week = client.followers.find((row) => row.periodTo === periodTo); if (week?.gain !== null && week?.gain !== undefined) { total += week.gain; any = true; } }
    return any ? total : null;
  };
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  const reporting = insights.filter((client) => client.media.some((week) => week.periodTo === last)).length;
  const tiles = [
    { label: "Investimento", fmt: money, series: weeks.map((w) => sum(w, (week) => week.spend)) },
    { label: "Alcance", fmt: compact, series: weeks.map((w) => sum(w, (week) => week.reach)) },
    { label: "Resultados", fmt: compact, series: weeks.map((w) => sum(w, (week) => week.outcomeValue)), hint: "conversas e visitas ao perfil" },
    { label: "Seguidores ganhos", fmt: compact, series: weeks.map((w) => gain(w)), hint: "informados no Feedback" },
  ];
  const [, month, day] = last.split("-");
  return (
    <div className="admin-card agency-media">
      <div className="home-card-head">
        <div>
          <p className="admin-card-title">Mídia da agência · semana até {day}/{month}</p>
          <p className="home-pulse-lede">{reporting} {reporting === 1 ? "cliente" : "clientes"} com relatório · números dos relatórios de anúncios</p>
        </div>
        <Link className="admin-btn ghost" href="/admin/performance">Performance →</Link>
      </div>
      <div className="agency-media-tiles">
        {tiles.map((tile) => {
          const current = tile.series[tile.series.length - 1];
          const change = prev ? delta(current, tile.series[tile.series.length - 2]) : null;
          return (
            <div className="agency-tile" key={tile.label}>
              <span className="agency-tile-label">{tile.label}</span>
              <strong>{tile.fmt(current)}</strong>
              <span className="agency-tile-foot">
                {change === null ? <em>{tile.hint ?? "sem semana anterior"}</em> : <em className={change >= 0 ? "up" : "down"}>{change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(0)}% vs. anterior</em>}
                <Sparkline values={tile.series} label={`${tile.label} nas últimas ${tile.series.length} semanas`} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
