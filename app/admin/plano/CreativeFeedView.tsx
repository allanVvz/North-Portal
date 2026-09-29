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
  if (value.includes("banner")) return "wide";
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

  const fail = (id: string) => setBroken((current) => new Set(current).add(id));

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
      // Três colunas (30/09): o Feed como o perfil mostra (4:5, reels cortados
      // e centralizados), só os Reels (9:16) e o resto. Um reels aparece no
      // Feed e nos Reels — é assim que o Instagram o publica.
      <div className="feed-columns">
        <FeedColumn title="Feed" hint="feed e reels, como no perfil" frame="grid" pieces={visible.filter(isProfilePiece)} onOpen={onOpen} onFail={fail} />
        <FeedColumn title="Reels" hint="9:16" frame="reels" pieces={visible.filter(isReels)} onOpen={onOpen} onFail={fail} />
        <FeedColumn title="Outros" hint="posts, carrosséis, banners, anúncios" frame="natural" pieces={visible.filter((piece) => !isReels(piece))} onOpen={onOpen} onFail={fail} />
      </div>
    ) : <div className="creative-feed-zero">Nenhuma peça com imagem {state ? `em "${PIECE_STATE_LABEL[state].toLowerCase()}"` : ""} {clientName ? `para ${clientName}` : ""}.</div>}
  </section>;
}

/** O que aparece na grade do perfil: banner (TV, loja) e anúncio não vão para o perfil. */
export function isProfilePiece(piece: Pick<Piece, "format">): boolean {
  return !/banner|an[uú]ncio/i.test(piece.format);
}

/** Reels (e stories): pelo formato, pelo título ou por um final em vídeo. */
export function isReels(piece: Pick<Piece, "format" | "title" | "isVideo">): boolean {
  return /reel|stor/i.test(piece.format) || /\breels?\b/i.test(piece.title) || piece.isVideo;
}

function FeedColumn({ title, hint, frame, pieces, onOpen, onFail }: {
  title: string;
  hint: string;
  frame: "grid" | "reels" | "natural";
  pieces: Piece[];
  onOpen: (taskId: string) => void;
  onFail: (id: string) => void;
}) {
  return (
    <section className={`feed-column is-${frame}`} aria-label={title}>
      <header className="feed-column-head"><h3>{title}</h3><span>{pieces.length} · {hint}</span></header>
      {pieces.length ? (
        <div className="feed-column-grid">
          {pieces.map((piece) => (
            <button type="button" key={piece.id} className={`feed-tile is-${frame === "natural" ? frameOf(piece.format) : frame}`} onClick={() => onOpen(piece.id)} aria-label={`Abrir ${piece.title}`} title={`${piece.title} · ${piece.clientName}`}>
              <span className="feed-tile-media"><PieceMedia piece={piece} onFail={() => onFail(piece.id)} /></span>
              <span className="feed-tile-badges">
                {isReels(piece) ? <span className="creative-feed-badge">▶</span> : null}
                {piece.legacy ? <span className="creative-feed-badge">antigo</span> : null}
              </span>
              <span className="feed-tile-caption">
                <b><span className={`op-dot tone-${STATE_TONE[piece.state]}`} aria-hidden />{piece.title}</b>
                <em>{piece.clientName}{piece.date ? ` · ${piece.date.slice(8, 10)}/${piece.date.slice(5, 7)}` : ""}</em>
              </span>
            </button>
          ))}
        </div>
      ) : <p className="feed-column-empty">Nada aqui neste recorte.</p>}
    </section>
  );
}
