"use client";

import { useEffect, useMemo, useState } from "react";
import type { Piece, PieceState } from "@/lib/pieces";

// O Feed de peças (29/09): entregas com arquivo final no Drive E cards legados
// com link do Drive (ex.: um card de Reels antigo, sem fluxo de etapas). Só
// entra o que tem imagem; a peça cuja miniatura não carrega sai da grade e é
// contada. Filtros por estado (concluída, atrasada, em produção) e cliente.
// Dados: /api/admin/pieces (lib/pieces.ts).

export const PIECE_STATE_LABEL: Record<PieceState, string> = { concluida: "Concluídas", atrasada: "Atrasadas", producao: "Em produção" };
const STATE_TONE: Record<PieceState, string> = { concluida: "done", atrasada: "late", producao: "ok" };

function frameOf(format: string): string {
  const value = format.toLowerCase();
  if (value.includes("reel") || value.includes("stor")) return "vertical";
  if (value.includes("carrossel")) return "carousel";
  return "post";
}

function PieceMedia({ piece, onFail }: { piece: Piece; onFail: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const current = piece.covers[attempt];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive
    <img key={current} src={`/api/admin/drive/thumbnail/${current}`} alt={`Capa de ${piece.title}`} loading="lazy" decoding="async"
      onError={() => { if (attempt + 1 < piece.covers.length) setAttempt(attempt + 1); else onFail(); }} />
  );
}

export default function CreativeFeedView({ clientName, initialState, onOpen }: {
  /** Recorte de cliente vindo da barra de filtros. */
  clientName: string | null;
  initialState?: PieceState | null;
  onOpen: (taskId: string) => void;
}) {
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<PieceState | null>(initialState ?? null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => setState(initialState ?? null), [initialState]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/pieces", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { pieces: Piece[] }) => { if (active) setPieces(data.pieces); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  const scoped = useMemo(() => (pieces ?? []).filter((piece) => !broken.has(piece.id) && (!clientName || piece.clientName === clientName)), [pieces, broken, clientName]);
  const visible = state ? scoped.filter((piece) => piece.state === state) : scoped;
  const count = (value: PieceState) => scoped.filter((piece) => piece.state === value).length;

  if (failed) return <div className="creative-feed-zero">Não foi possível carregar as peças agora.</div>;
  if (!pieces) return <div className="creative-feed-zero">Carregando as peças e as capas do Drive…</div>;

  return <section className="creative-feed" aria-label="Feed de peças">
    <div className="creative-feed-heading">
      <div className="feed-states" role="group" aria-label="Filtrar por estado">
        <button type="button" aria-pressed={state === null} className={state === null ? "on" : ""} onClick={() => setState(null)}>Todas <b>{scoped.length}</b></button>
        {(Object.keys(PIECE_STATE_LABEL) as PieceState[]).map((value) => (
          <button type="button" key={value} aria-pressed={state === value} className={state === value ? "on" : ""} onClick={() => setState(value)}>
            <span className={`op-dot tone-${STATE_TONE[value]}`} aria-hidden />{PIECE_STATE_LABEL[value]} <b>{count(value)}</b>
          </button>
        ))}
      </div>
      {broken.size ? <small>{broken.size} sem miniatura no Drive ficaram fora</small> : null}
    </div>
    {visible.length ? (
      <div className="creative-feed-grid">
        {visible.map((piece) => (
          <article className="creative-feed-card" key={piece.id}>
            <button type="button" className={`creative-feed-media is-${frameOf(piece.format)}`} onClick={() => onOpen(piece.id)} aria-label={`Abrir ${piece.title}`}>
              <span className="creative-feed-media-image"><PieceMedia piece={piece} onFail={() => setBroken((current) => new Set(current).add(piece.id))} /></span>
              <span className="creative-feed-badges">
                {piece.coverSource === "final" ? <span className="creative-feed-badge is-publish">Final</span> : null}
                {piece.isVideo ? <span className="creative-feed-badge">▶ vídeo</span> : null}
                {piece.legacy ? <span className="creative-feed-badge">card antigo</span> : null}
              </span>
            </button>
            <div className="creative-feed-caption">
              <strong title={piece.title}>{piece.title}</strong>
              <span className="op-lean-state"><span className={`op-dot tone-${STATE_TONE[piece.state]}`} aria-hidden /><b>{PIECE_STATE_LABEL[piece.state].replace(/s$/, "")}</b>{piece.date ? <em>· {piece.date.slice(8, 10)}/{piece.date.slice(5, 7)}</em> : null}</span>
              <small>{piece.clientName}{piece.format ? ` · ${piece.format}` : ""}</small>
            </div>
          </article>
        ))}
      </div>
    ) : <div className="creative-feed-zero">Nenhuma peça com imagem {state ? `em "${PIECE_STATE_LABEL[state].toLowerCase()}"` : ""} {clientName ? `para ${clientName}` : ""}.</div>}
  </section>;
}
