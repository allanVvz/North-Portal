"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Piece, PieceState } from "@/lib/pieces";

// Atalho do Feed (29/09): o global das peças com imagem — quantas concluídas,
// atrasadas e em produção — e as capas mais recentes. Cada estado abre o Feed
// de Planos e Entregas já filtrado.

const STATES: { key: PieceState; label: string; tone: string }[] = [
  { key: "concluida", label: "concluídas", tone: "done" },
  { key: "atrasada", label: "atrasadas", tone: "late" },
  { key: "producao", label: "em produção", tone: "ok" },
];
const feedHref = (state?: PieceState) => `/admin/operacao?area=planos-entregas&visao=feed${state ? `&estado=${state}` : ""}`;

export default function FeedShortcut() {
  const [data, setData] = useState<{ pieces: Piece[]; counts: Record<PieceState, number>; total: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    fetch("/api/admin/pieces?limit=10", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((json) => { if (active) setData(json); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  if (!data || !data.total) return null;
  const covers = data.pieces.filter((piece) => !hidden.has(piece.id)).slice(0, 6);
  return (
    <div className="admin-card feed-shortcut">
      <div className="home-card-head">
        <p className="admin-card-title">Feed · {data.total} peças</p>
        <Link className="admin-btn ghost" href={feedHref()}>Abrir →</Link>
      </div>
      <div className="feed-shortcut-states">
        {STATES.map((state) => (
          <Link key={state.key} href={feedHref(state.key)} className="feed-shortcut-state">
            <span className={`op-dot tone-${state.tone}`} aria-hidden />
            <b>{data.counts[state.key]}</b> {state.label}
          </Link>
        ))}
      </div>
      <div className="feed-shortcut-strip">
        {covers.map((piece) => (
          <Link key={piece.id} href={feedHref(piece.state)} className="feed-shortcut-thumb" title={`${piece.title} · ${piece.clientName}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive */}
            <img src={`/api/admin/drive/thumbnail/${piece.covers[0]}`} alt="" loading="lazy" decoding="async" onError={() => setHidden((current) => new Set(current).add(piece.id))} />
            <span className={`op-dot tone-${STATES.find((state) => state.key === piece.state)?.tone}`} aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}
