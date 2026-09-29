"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TrendChart from "../../performance/charts/TrendChart";
import Sparkline from "../../home/Sparkline";
import { compact, delta, money, useClientInsights } from "../../home/useInsights";
import { operacaoHref } from "../../operacao/operacaoLinks";
import type { Piece } from "@/lib/pieces";
import InsightsRail from "../../insights/InsightsRail";
import { buildInsightCandidates } from "../../insights/insightCandidates";
import { useOperationData } from "../../operacao/useOperationItems";
import { agencyToday } from "../../recurringState";

// O cliente em números (29/09): o que os relatórios semanais e as automações
// já sabem, na ordem da história — a semana, a tendência, a conversão que a
// equipe informa, os relatórios e as peças. Tudo vem de
// /api/admin/insights/clients e /api/admin/pieces; nada aqui é digitado.

const shortWeek = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Change({ current, previous }: { current: number | null; previous: number | null | undefined }) {
  const value = delta(current, previous);
  if (value === null) return <em>primeira semana</em>;
  return <em className={value >= 0 ? "up" : "down"}>{value >= 0 ? "↑" : "↓"} {Math.abs(value).toFixed(0)}% vs. anterior</em>;
}

export default function ClientInsightsPanel({ slug, clientName }: { slug: string; clientName: string }) {
  const insights = useClientInsights(slug);
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    fetch(`/api/admin/pieces?cliente=${encodeURIComponent(slug)}&limit=12`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { pieces: Piece[] }) => { if (active) setPieces(data.pieces); })
      .catch(() => { if (active) setPieces([]); });
    return () => { active = false; };
  }, [slug]);

  const client = insights?.[0] ?? null;
  const ops = useOperationData();
  const today = useMemo(() => agencyToday(), []);
  const candidates = useMemo(
    () => (ops && insights && pieces ? buildInsightCandidates("cliente", { items: ops.items, tasks: ops.tasks, today, insights, pieces, client: { slug, name: clientName } }) : null),
    [ops, insights, pieces, today, slug, clientName],
  );
  const media = client?.media ?? [];
  const last = media.at(-1) ?? null;
  const prev = media.at(-2) ?? null;
  const followers = client?.followers ?? [];
  const lastGain = followers.filter((week) => week.gain !== null).at(-1) ?? null;
  const lastTotal = followers.filter((week) => week.total !== null).at(-1) ?? null;
  const lastReport = client?.reports.find((report) => report.kind === "anuncios") ?? null;
  const visiblePieces = (pieces ?? []).filter((piece) => !broken.has(piece.id)).slice(0, 8);

  return (
    <div className="client-insights">
      <InsightsRail screen="cliente" candidates={candidates} />
      <div className="client-links">
        <Link className="admin-btn ghost" href={operacaoHref({ cliente: clientName, agrupar: "prazo" })}>Operação do cliente →</Link>
        <Link className="admin-btn ghost" href={`/admin/operacao?area=planos-entregas&visao=feed`}>Feed →</Link>
        <Link className="admin-btn ghost" href={`/admin/performance?cliente=${encodeURIComponent(slug)}`}>Investimento e mídia na Performance →</Link>
      </div>

      {!insights ? <div className="admin-card"><p className="admin-hint">Carregando os números dos relatórios…</p></div> : !last ? (
        <div className="admin-card"><p className="admin-card-title">Esta semana</p><p className="admin-hint">Ainda não há relatório de anúncios para este cliente. Os números aparecem aqui depois da primeira execução da automação.</p></div>
      ) : (
        <div className="admin-card">
          <div className="home-card-head">
            <div>
              <p className="admin-card-title">Semana de {shortWeek(last.periodFrom)} a {shortWeek(last.periodTo)}</p>
              <p className="home-pulse-lede">Do relatório de anúncios{last.reachCorrected ? " · alcance corrigido pela equipe" : ""}{client?.nextReport ? (client.nextReport < new Date().toISOString().slice(0, 10) ? ` · relatório atrasado desde ${shortWeek(client.nextReport)}` : ` · próximo relatório em ${shortWeek(client.nextReport)}`) : ""}</p>
            </div>
            {lastReport ? <a className="admin-btn ghost" href={lastReport.url} target="_blank" rel="noreferrer">PDF da semana ↗</a> : null}
          </div>
          <div className="agency-media-tiles">
            <div className="agency-tile"><span className="agency-tile-label">Alcance</span><strong>{compact(last.reach)}</strong><span className="agency-tile-foot"><Change current={last.reach} previous={prev?.reach} /><Sparkline values={media.map((week) => week.reach)} label="Alcance por semana" /></span></div>
            <div className="agency-tile"><span className="agency-tile-label">{last.outcomeLabel}</span><strong>{compact(last.outcomeValue)}</strong><span className="agency-tile-foot"><Change current={last.outcomeValue} previous={prev?.outcomeValue} /><Sparkline values={media.map((week) => week.outcomeValue)} label={`${last.outcomeLabel} por semana`} /></span></div>
            <div className="agency-tile"><span className="agency-tile-label">Seguidores</span><strong>{lastGain?.gain !== null && lastGain?.gain !== undefined ? `+${compact(lastGain.gain)}` : compact(lastTotal?.total)}</strong><span className="agency-tile-foot"><em>{lastTotal?.total ? `${compact(lastTotal.total)} no perfil` : "informados no Feedback"}</em><Sparkline values={followers.map((week) => week.total)} label="Seguidores no perfil por semana" /></span></div>
          </div>
        </div>
      )}

      {media.length >= 2 ? (
        <div className="client-charts">
          <div className="admin-card">
            <p className="admin-card-title">{last?.outcomeLabel ?? "Resultados"} por semana</p>
            <TrendChart data={media.map((week) => ({ date: week.periodTo, resultados: week.outcomeValue ?? 0 }))} series={[{ key: "resultados", label: last?.outcomeLabel ?? "Resultados" }]} />
          </div>
          <div className="admin-card">
            <p className="admin-card-title">Alcance por semana</p>
            <TrendChart data={media.map((week) => ({ date: week.periodTo, alcance: week.reach ?? 0 }))} series={[{ key: "alcance", label: "Alcance" }]} />
          </div>
        </div>
      ) : null}

      <div className="client-row">
        <div className="admin-card">
          <p className="admin-card-title">Conversão informada</p>
          {client?.conversion.length ? (
            <ul className="visao-kv">
              {(() => { const week = client.conversion.at(-1)!; return [["Vendas", week.vendas], ["Agendamentos", week.agendamentos], ["Receita", week.receita]].filter(([, value]) => value !== null).map(([label, value]) => (
                <li key={String(label)}><span>{label}</span><strong>{label === "Receita" ? money(value as number) : compact(value as number)}</strong></li>
              )); })()}
            </ul>
          ) : <p className="admin-hint">Vendas, agendamentos e receita aparecem aqui quando a equipe informar no comentário do Feedback da semana (por exemplo, "3 vendas, R$ 4.200").</p>}
        </div>
        <div className="admin-card">
          <p className="admin-card-title">Relatórios recentes</p>
          {client?.reports.length ? (
            <ul className="client-reports">
              {client.reports.map((report) => (
                <li key={report.url}><a href={report.url} target="_blank" rel="noreferrer"><span className={`client-report-kind is-${report.kind}`}>{report.kind === "anuncios" ? "Anúncios" : "Conversão"}</span>{report.date ? `semana até ${shortWeek(report.date)}` : report.name} ↗</a></li>
              ))}
            </ul>
          ) : <p className="admin-hint">Nenhum relatório gerado ainda.</p>}
        </div>
      </div>

      {visiblePieces.length ? (
        <div className="admin-card">
          <div className="home-card-head"><p className="admin-card-title">Peças do cliente</p><Link className="admin-btn ghost" href="/admin/operacao?area=planos-entregas&visao=feed">Ver no Feed →</Link></div>
          <div className="client-pieces">
            {visiblePieces.map((piece) => (
              <figure key={piece.id} className="client-piece">
                {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive */}
                <img src={`/api/admin/drive/thumbnail/${piece.covers[0]}`} alt={`Capa de ${piece.title}`} loading="lazy" decoding="async" onError={() => setBroken((current) => new Set(current).add(piece.id))} />
                <figcaption><span className={`op-dot tone-${piece.state === "concluida" ? "done" : piece.state === "atrasada" ? "late" : "ok"}`} aria-hidden />{piece.title}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
