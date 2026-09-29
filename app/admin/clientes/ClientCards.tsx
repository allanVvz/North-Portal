"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Piece, PieceState } from "@/lib/pieces";
import type { ClientInsight } from "@/lib/insights/clientInsights";
import { ATTENTION_LABEL } from "@/lib/adminHome";
import type { ClientRow } from "../ClientsTable";
import { STAGE_LABEL } from "../clientPipeline";
import Sparkline from "../home/Sparkline";
import { compact, delta, money } from "../home/useInsights";
import { operationState, type OperationItem } from "../operacao/operationItems";
import { operacaoHref } from "../operacao/operacaoLinks";

// Painel de clientes (29/09; largura total e sem investimento em 30/09): um
// card por cliente contando, de cima para baixo, como ele está — saúde da
// operação, o que está aberto, alcance e resultados da última semana,
// seguidores, conversão informada, peças e relatórios. Investimento mora só
// na Performance. Os dados chegam de ClientesWorkspace (uma leitura por
// visita); aqui tudo é derivado em memória, com mapas por slug.

type Health = {
  late: number;
  warn: number;
  ok: number;
  open: Record<OperationItem["level"], number>;
  people: Set<string>;
  worst: { item: OperationItem; stage: string; detail: string } | null;
};

const LEVEL_WORD: Record<OperationItem["level"], [string, string]> = {
  rotina: ["rotina", "rotinas"], plano: ["plano", "planos"], entrega: ["entrega", "entregas"], tarefa: ["tarefa", "tarefas"],
};
const PIECE_TONE: Record<PieceState, string> = { concluida: "done", atrasada: "late", producao: "ok" };
const PIECE_WORD: Record<PieceState, string> = { concluida: "concluídas", atrasada: "atrasadas", producao: "em produção" };
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;

function Change({ current, previous }: { current: number | null | undefined; previous: number | null | undefined }) {
  const value = delta(current, previous);
  if (value === null) return null;
  return <i className={value >= 0 ? "up" : "down"}>{value >= 0 ? "↑" : "↓"}{Math.abs(value).toFixed(0)}%</i>;
}

export default function ClientCards({ clients, items, pieces, insights, today }: {
  clients: ClientRow[];
  /** null enquanto carrega (dados levantados em ClientesWorkspace). */
  items: OperationItem[] | null;
  pieces: Piece[];
  insights: ClientInsight[] | null;
  today: string;
}) {
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const health = useMemo(() => {
    const map = new Map<string, Health>();
    for (const item of items ?? []) {
      const state = operationState(item, today);
      if (state.tone === "done") continue;
      const current = map.get(item.clientSlug) ?? { late: 0, warn: 0, ok: 0, open: { rotina: 0, plano: 0, entrega: 0, tarefa: 0 }, people: new Set<string>(), worst: null };
      if (state.tone === "late") current.late += 1; else if (state.tone === "warn") current.warn += 1; else current.ok += 1;
      current.open[item.level] += 1;
      for (const name of (item.task.assignee ?? "").split(",")) if (name.trim()) current.people.add(name.trim().split(/\s+/)[0]);
      if (state.tone === "late" && !current.worst) current.worst = { item, stage: state.stage, detail: state.detail };
      map.set(item.clientSlug, current);
    }
    return map;
  }, [items, today]);

  const piecesBySlug = useMemo(() => {
    const map = new Map<string, Piece[]>();
    for (const piece of pieces) {
      if (broken.has(piece.id)) continue;
      const list = map.get(piece.clientSlug);
      if (list) list.push(piece); else map.set(piece.clientSlug, [piece]);
    }
    return map;
  }, [pieces, broken]);

  const insightBySlug = useMemo(() => new Map((insights ?? []).map((row) => [row.slug, row])), [insights]);

  const active = clients.filter((client) => !client.disabled);
  const ordered = [...active].sort((a, b) => {
    const ha = health.get(a.slug), hb = health.get(b.slug);
    return (hb?.late ?? 0) - (ha?.late ?? 0) || (hb?.warn ?? 0) - (ha?.warn ?? 0) || a.name.localeCompare(b.name, "pt-BR");
  });
  const fail = (id: string) => setBroken((current) => new Set(current).add(id));

  return (
    <div className="client-cards">
      {ordered.map((client) => (
        <ClientCard key={client.slug} client={client} today={today} loadingOps={!items} health={health.get(client.slug) ?? null}
          insight={insightBySlug.get(client.slug) ?? null} loadingInsights={!insights} pieces={piecesBySlug.get(client.slug) ?? []} onBroken={fail} />
      ))}
    </div>
  );
}

function ClientCard({ client, today, loadingOps, health: h, insight, loadingInsights, pieces, onBroken }: {
  client: ClientRow; today: string; loadingOps: boolean; health: Health | null; insight: ClientInsight | null;
  loadingInsights: boolean; pieces: Piece[]; onBroken: (id: string) => void;
}) {
  const media = insight?.media ?? [];
  const last = media.at(-1) ?? null;
  const prev = media.at(-2) ?? null;
  const followers = insight?.followers ?? [];
  const gainWeek = followers.filter((week) => week.gain !== null).at(-1) ?? null;
  const totalWeek = followers.filter((week) => week.total !== null).at(-1) ?? null;
  const conversion = insight?.conversion.at(-1) ?? null;
  const lastPdf = insight?.reports[0] ?? null;
  const tone = !h ? "idle" : h.late ? "late" : h.warn ? "warn" : "ok";
  const pieceCount = (state: PieceState) => pieces.filter((piece) => piece.state === state).length;
  const openLevels = h ? (Object.keys(LEVEL_WORD) as OperationItem["level"][]).filter((level) => h.open[level] > 0) : [];
  const people = h ? [...h.people].slice(0, 4) : [];
  const attention = client.attention ?? [];
  const secondary = last ? [
    last.profileVisits ? `${compact(last.profileVisits)} visitas ao perfil` : "",
    last.conversations ? `${compact(last.conversations)} conversas` : "",
    last.linkClicks ? `${compact(last.linkClicks)} cliques` : "",
    last.impressions ? `${compact(last.impressions)} impressões` : "",
  ].filter(Boolean) : [];

  return (
    <article className={`client-card tone-${tone}`}>
      <header className="client-card-head">
        <div className="client-card-title">
          <Link href={`/admin/${client.slug}/visao`} className="client-card-name">{client.name}</Link>
          <span className="client-card-stage" title={`Checkpoints ${client.checkpointsPct}%`}>{STAGE_LABEL[client.stage]}{client.stage !== "operacao" ? ` · ${client.checkpointsPct}%` : ""}</span>
        </div>
        <span className="client-card-health">
          <span className={`op-dot tone-${tone}`} aria-hidden />
          {loadingOps ? "carregando a operação…" : !h ? "nada aberto na operação" : [h.late ? `${h.late} atrasado${h.late === 1 ? "" : "s"}` : "", h.warn ? `${h.warn} em atenção` : "", !h.late && !h.warn ? "em dia" : ""].filter(Boolean).join(" · ")}
        </span>
      </header>

      {h?.worst ? <p className="client-card-worst" title={h.worst.item.task.title}>{h.worst.item.task.title} <em>· {h.worst.stage}{h.worst.detail ? `, ${h.worst.detail}` : ""}</em></p> : null}
      {openLevels.length || people.length || attention.length ? (
        <div className="client-card-ops">
          {openLevels.length ? <span>{openLevels.map((level) => plural(h!.open[level], LEVEL_WORD[level])).join(" · ")} abertos</span> : null}
          {people.length ? <span className="client-card-people">{people.join(", ")}{h && h.people.size > people.length ? ` +${h.people.size - people.length}` : ""}</span> : null}
          {attention.map((reason) => <span key={reason} className="client-card-flag">{ATTENTION_LABEL[reason]}</span>)}
        </div>
      ) : null}

      <section className="client-card-media" aria-label="Mídia da última semana">
        <p className="client-card-label">{last ? `Semana ${shortDate(last.periodFrom)}–${shortDate(last.periodTo)}${last.reachCorrected ? " · alcance corrigido" : ""}` : "Mídia"}</p>
        {last ? (
          <div className="client-card-stats">
            <div><span>Alcance</span><strong>{compact(last.reach)}</strong><em><Change current={last.reach} previous={prev?.reach} />{media.length > 1 ? <Sparkline values={media.map((week) => week.reach)} label="Alcance por semana" /> : null}</em></div>
            <div><span>{last.outcomeLabel}</span><strong>{compact(last.outcomeValue)}</strong><em><Change current={last.outcomeValue} previous={prev?.outcomeValue} />{media.length > 1 ? <Sparkline values={media.map((week) => week.outcomeValue)} label="Resultados por semana" /> : null}</em></div>
            <div><span>Seguidores</span><strong>{gainWeek?.gain != null ? `+${compact(gainWeek.gain)}` : compact(totalWeek?.total)}</strong><em>{totalWeek?.total != null && gainWeek?.gain != null ? `${compact(totalWeek.total)} no perfil` : gainWeek ? "na semana" : totalWeek ? "no perfil" : "sem Feedback"}</em></div>
          </div>
        ) : <p className="client-card-empty">{loadingInsights ? "Carregando os relatórios…" : "Sem relatório de anúncios ainda."}{!loadingInsights && totalWeek?.total != null ? ` ${compact(totalWeek.total)} seguidores no perfil.` : ""}</p>}
        {secondary.length ? <p className="client-card-secondary">{secondary.join(" · ")}</p> : null}
        {conversion && (conversion.vendas !== null || conversion.agendamentos !== null || conversion.receita !== null) ? (
          <p className="client-card-conversion">
            <b>Conversão até {shortDate(conversion.periodTo)}</b>
            {[conversion.vendas !== null ? `${compact(conversion.vendas)} vendas` : "", conversion.agendamentos !== null ? `${compact(conversion.agendamentos)} agendamentos` : "", conversion.receita !== null ? money(conversion.receita) : ""].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </section>

      {pieces.length ? (
        <section className="client-card-pieces" aria-label="Peças">
          <div className="client-card-thumbs">
            {pieces.slice(0, 6).map((piece) => (
              // eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive
              <img key={piece.id} src={`/api/admin/drive/thumbnail/${piece.covers[0]}`} alt="" title={piece.title} loading="lazy" decoding="async" onError={() => onBroken(piece.id)} />
            ))}
          </div>
          <p>{(Object.keys(PIECE_WORD) as PieceState[]).filter((state) => pieceCount(state) > 0).map((state) => (
            <span key={state}><span className={`op-dot tone-${PIECE_TONE[state]}`} aria-hidden />{pieceCount(state)} {PIECE_WORD[state]}</span>
          ))}</p>
        </section>
      ) : null}

      <footer className="client-card-foot">
        <span className="client-card-reports">
          {insight?.nextReport ? <>Relatório {insight.nextReport < today ? <b className="late">atrasado desde {shortDate(insight.nextReport)}</b> : <>em {shortDate(insight.nextReport)}</>}</> : null}
          {lastPdf ? <a href={lastPdf.url} target="_blank" rel="noreferrer">{insight?.nextReport ? " · " : ""}último PDF ↗</a> : null}
        </span>
        <nav>
          <Link href={operacaoHref({ cliente: client.name, agrupar: "prazo" })}>Operação</Link>
          <Link href={`/admin/performance?cliente=${encodeURIComponent(client.slug)}`}>Performance</Link>
        </nav>
      </footer>
    </article>
  );
}
