"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RecurringTask } from "@/lib/supabase";
import type { Piece } from "@/lib/pieces";
import type { ClientRow } from "../ClientsTable";
import Sparkline from "../home/Sparkline";
import { compact, delta, money, useClientInsights } from "../home/useInsights";
import { agencyToday } from "../recurringState";
import { normalizeOperationItems, operationState, type OperationItem, type OperationTask } from "../operacao/operationItems";
import { operacaoHref } from "../operacao/operacaoLinks";

// Painel de clientes (29/09): um card por cliente contando, de cima para
// baixo, como ele está — saúde da operação, seguidores, mídia da última
// semana, peças e o próximo relatório. Mesmas fontes da Home e da página do
// cliente: estado único da Operação, relatórios de anúncios e o Feedback.

type Health = { late: number; warn: number; ok: number; worst: { item: OperationItem; stage: string; detail: string } | null };

export default function ClientCards({ clients }: { clients: ClientRow[] }) {
  const today = useMemo(() => agencyToday(), []);
  const insights = useClientInsights();
  const [items, setItems] = useState<OperationItem[] | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/admin/tasks", { cache: "no-store" }), fetch("/api/admin/routines", { cache: "no-store" }), fetch("/api/admin/pieces?limit=500", { cache: "no-store" })])
      .then(async ([tasks, routines, feed]) => {
        const taskData = tasks.ok ? await tasks.json() as { tasks?: OperationTask[] } : { tasks: [] };
        const routineData = routines.ok ? await routines.json() as { tasks?: RecurringTask[] } : { tasks: [] };
        const feedData = feed.ok ? await feed.json() as { pieces?: Piece[] } : { pieces: [] };
        if (!active) return;
        setItems(normalizeOperationItems(taskData.tasks ?? [], routineData.tasks ?? []));
        setPieces(feedData.pieces ?? []);
      })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, []);

  const health = useMemo(() => {
    const map = new Map<string, Health>();
    for (const item of items ?? []) {
      const state = operationState(item, today);
      if (state.tone === "done") continue;
      const current = map.get(item.clientSlug) ?? { late: 0, warn: 0, ok: 0, worst: null };
      if (state.tone === "late") current.late += 1; else if (state.tone === "warn") current.warn += 1; else current.ok += 1;
      if (state.tone === "late" && !current.worst) current.worst = { item, stage: state.stage, detail: state.detail };
      map.set(item.clientSlug, current);
    }
    return map;
  }, [items, today]);

  const active = clients.filter((client) => !client.disabled);
  const ordered = [...active].sort((a, b) => (health.get(b.slug)?.late ?? 0) - (health.get(a.slug)?.late ?? 0) || a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="client-cards">
      {ordered.map((client) => {
        const h = health.get(client.slug);
        const insight = insights?.find((row) => row.slug === client.slug) ?? null;
        const last = insight?.media.at(-1) ?? null;
        const prev = insight?.media.at(-2) ?? null;
        const gain = insight?.followers.filter((week) => week.gain !== null).at(-1)?.gain ?? null;
        const total = insight?.followers.filter((week) => week.total !== null).at(-1)?.total ?? null;
        const clientPieces = pieces.filter((piece) => piece.clientSlug === client.slug && !broken.has(piece.id));
        const doneThisMonth = clientPieces.filter((piece) => piece.state === "concluida" && piece.date?.slice(0, 7) === today.slice(0, 7)).length;
        const tone = !h ? "idle" : h.late ? "late" : h.warn ? "warn" : "ok";
        const spendChange = delta(last?.spend ?? null, prev?.spend);
        return (
          <article key={client.slug} className={`client-card tone-${tone}`}>
            <header className="client-card-head">
              <Link href={`/admin/${client.slug}/visao`} className="client-card-name">{client.name}</Link>
              <span className="client-card-health">
                <span className={`op-dot tone-${tone}`} aria-hidden />
                {!items ? "…" : !h ? "sem pendências" : [h.late ? `${h.late} atrasado${h.late === 1 ? "" : "s"}` : "", h.warn ? `${h.warn} em atenção` : "", !h.late && !h.warn ? "em dia" : ""].filter(Boolean).join(" · ")}
              </span>
            </header>
            {h?.worst ? <p className="client-card-worst">{h.worst.item.task.title} <em>· {h.worst.stage}{h.worst.detail ? `, ${h.worst.detail}` : ""}</em></p> : null}

            <div className="client-card-stats">
              <div>
                <span>Seguidores</span>
                <strong>{gain !== null ? `+${compact(gain)}` : total !== null ? compact(total) : "—"}</strong>
                <em>{!insights ? "carregando…" : gain !== null && total !== null ? `${compact(total)} no perfil` : gain !== null ? "na semana" : total !== null ? "no perfil" : "sem Feedback ainda"}</em>
              </div>
              <div>
                <span>Investimento</span>
                <strong>{money(last?.spend)}</strong>
                <em>{!insights ? "carregando…" : spendChange === null ? (last ? "última semana" : "sem relatório") : `${spendChange >= 0 ? "↑" : "↓"} ${Math.abs(spendChange).toFixed(0)}%`}</em>
              </div>
              <div>
                <span>{last?.outcomeLabel ?? "Resultados"}</span>
                <strong>{compact(last?.outcomeValue)}</strong>
                <em>{last?.outcomeCost !== null && last?.outcomeCost !== undefined ? `${money(last.outcomeCost)} cada` : "—"}</em>
              </div>
            </div>
            {insight && insight.media.length > 1 ? <div className="client-card-spark"><Sparkline values={insight.media.map((week) => week.spend)} label="Investimento por semana" /><em>investimento, {insight.media.length} semanas</em></div> : null}

            {clientPieces.length ? (
              <div className="client-card-pieces">
                {clientPieces.slice(0, 4).map((piece) => (
                  // eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive
                  <img key={piece.id} src={`/api/admin/drive/thumbnail/${piece.covers[0]}`} alt="" title={piece.title} loading="lazy" decoding="async" onError={() => setBroken((current) => new Set(current).add(piece.id))} />
                ))}
                <em>{doneThisMonth ? `${doneThisMonth} concluída${doneThisMonth === 1 ? "" : "s"} no mês` : `${clientPieces.length} peça${clientPieces.length === 1 ? "" : "s"}`}</em>
              </div>
            ) : null}

            <footer className="client-card-foot">
              {insight?.nextReport ? <span>Relatório {insight.nextReport < today ? <b className="late">atrasado desde {insight.nextReport.slice(8, 10)}/{insight.nextReport.slice(5, 7)}</b> : <>em {insight.nextReport.slice(8, 10)}/{insight.nextReport.slice(5, 7)}</>}</span> : <span />}
              <nav>
                <Link href={operacaoHref({ cliente: client.name, agrupar: "prazo" })}>Operação</Link>
                <Link href={`/admin/performance?cliente=${encodeURIComponent(client.slug)}`}>Performance</Link>
              </nav>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
