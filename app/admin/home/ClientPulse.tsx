"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RecurringTask } from "@/lib/supabase";
import { normalizeOperationItems, operationState, type OperationItem, type OperationState, type OperationTask } from "../operacao/operationItems";
import type { ClientInsight } from "@/lib/insights/clientInsights";

// Pulso por cliente (29/09): a pergunta "como está cada cliente?" respondida
// com os MESMOS itens e o MESMO estado único da Operação — cada trabalho uma
// vez, rotina > plano > entrega > tarefa. Cada linha conta a história em
// três partes: quanto está em dia, o que pede atenção e o item mais crítico,
// que abre direto.

type Row = {
  client: string;
  slug: string;
  total: number;
  late: number;
  warn: number;
  ok: number;
  worst: { item: OperationItem; state: OperationState } | null;
};

const RANK: Record<OperationState["tone"], number> = { late: 0, warn: 1, ok: 2, idle: 3, done: 4 };

export default function ClientPulse({ today, insights, onOpen }: {
  today: string;
  insights?: ClientInsight[] | null;
  onOpen: (item: { id: string; clientName: string; clientSlug: string }) => void;
}) {
  const [items, setItems] = useState<OperationItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/admin/tasks", { cache: "no-store" }), fetch("/api/admin/routines", { cache: "no-store" })])
      .then(async ([tasks, routines]) => {
        if (!tasks.ok) throw new Error();
        const taskData = await tasks.json() as { tasks?: OperationTask[] };
        const routineData = routines.ok ? await routines.json() as { tasks?: RecurringTask[] } : { tasks: [] };
        if (active) setItems(normalizeOperationItems(taskData.tasks ?? [], routineData.tasks ?? []));
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!items) return [];
    const byClient = new Map<string, Row>();
    for (const item of items) {
      const state = operationState(item, today);
      if (state.tone === "done") continue; // concluído não pesa no pulso
      const name = item.clientName && item.clientName !== "—" && item.clientName !== "Outros" ? item.clientName : "Sem cliente";
      const row = byClient.get(name) ?? { client: name, slug: item.clientSlug, total: 0, late: 0, warn: 0, ok: 0, worst: null };
      row.total += 1;
      if (state.tone === "late") row.late += 1;
      else if (state.tone === "warn") row.warn += 1;
      else row.ok += 1;
      if (!row.worst || RANK[state.tone] < RANK[row.worst.state.tone]) row.worst = { item, state };
      byClient.set(name, row);
    }
    return [...byClient.values()].sort((a, b) => b.late - a.late || b.warn - a.warn || a.client.localeCompare(b.client, "pt-BR"));
  }, [items, today]);

  // Seguidores ganhos na última semana informada, vindos do Feedback.
  const gainOf = (slug: string) => insights?.find((client) => client.slug === slug)?.followers.filter((week) => week.gain !== null).at(-1)?.gain ?? null;
  const late = rows.reduce((sum, row) => sum + row.late, 0);
  const calm = rows.filter((row) => row.late === 0 && row.warn === 0).length;

  return (
    <div className="admin-card home-card-wide home-pulse">
      <div className="home-card-head">
        <div>
          <p className="admin-card-title">Pulso por cliente</p>
          {items ? <p className="home-pulse-lede">{late ? `${late} ${late === 1 ? "item atrasado" : "itens atrasados"} na agência` : "Nada atrasado na agência"} · {calm} de {rows.length} clientes sem pendência</p> : null}
        </div>
        <Link className="admin-btn ghost" href="/admin/operacao?area=tarefas-rotinas">Operação →</Link>
      </div>
      {failed ? <p className="admin-hint">Não foi possível carregar os clientes agora.</p> : !items ? (
        <p className="admin-hint">Carregando…</p>
      ) : (
        <ul className="home-pulse-list">
          {rows.map((row) => (
            <li key={row.client} className="home-pulse-row">
              <span className="home-pulse-client">
                {row.slug ? <Link href={`/admin/${row.slug}/visao`}><strong>{row.client}</strong></Link> : <strong>{row.client}</strong>}
                <em>{row.total} {row.total === 1 ? "item" : "itens"}{row.late ? ` · ${row.late} atrasado${row.late === 1 ? "" : "s"}` : ""}{row.warn ? ` · ${row.warn} em atenção` : ""}{gainOf(row.slug) ? ` · +${gainOf(row.slug)} seguidores` : ""}</em>
              </span>
              <span className="home-pulse-bar" aria-label={`${row.ok} de ${row.total} em dia`}>
                <i className="ok" style={{ flexGrow: row.ok }} />
                <i className="warn" style={{ flexGrow: row.warn }} />
                <i className="late" style={{ flexGrow: row.late }} />
              </span>
              {row.worst && row.worst.state.tone !== "ok" && row.worst.state.tone !== "idle" ? (
                <button type="button" className="home-pulse-worst" onClick={() => onOpen({ id: row.worst!.item.id, clientName: row.worst!.item.clientName, clientSlug: row.worst!.item.clientSlug })}>
                  <span className={`op-dot tone-${row.worst.state.tone}`} aria-hidden />
                  <span className="home-pulse-worst-text"><b>{row.worst.item.task.title}</b><em>{row.worst.state.stage}{row.worst.state.detail ? ` · ${row.worst.state.detail}` : ""}</em></span>
                </button>
              ) : <span className="home-pulse-calm">Tudo em dia</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
