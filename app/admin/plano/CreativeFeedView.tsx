"use client";

import { useState } from "react";
import { materialCoverCandidates, type CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import { taskCoverCandidates } from "@/lib/taskCover";
import type { TaskCover } from "@/lib/taskCover";
import type { FlowDelivery } from "@/lib/supabase";

function formatOf(card: FlowDelivery): string {
  const stored = typeof card.payload?.formato === "string" ? card.payload.formato.trim() : "";
  return stored || (/(reels?|stories?|carrossel|horizontal)/i.exec(card.title)?.[0] ?? "");
}

function frameOf(format: string): string {
  const value = format.toLowerCase();
  if (value.includes("reel") || value.includes("stor") || value.includes("vertical")) return "vertical";
  if (value.includes("horizontal") || value.includes("banner")) return "wide";
  if (value.includes("carrossel")) return "carousel";
  return "post";
}

function FeedMedia({ candidates, title, onRatio }: { candidates: TaskCover[]; title: string; onRatio: (value: number) => void }) {
  const [attempt, setAttempt] = useState(0);
  const current = candidates[attempt];
  if (!current) return <span className="creative-feed-empty-media" aria-hidden="true"><svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="8" width="34" height="32" rx="6" /><circle cx="18" cy="18" r="3" /><path d="m10 35 11-11 7 7 5-5 8 8" /></svg></span>;
  return <span className="creative-feed-media-image">
    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated Drive thumbnail route */}
    <img key={current.fileId} src={`/api/admin/drive/thumbnail/${current.fileId}`} alt={`Capa de ${title}`} loading="lazy" decoding="async" onError={() => setAttempt((value) => value + 1)} onLoad={(event) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (naturalWidth && naturalHeight) onRatio(naturalWidth / naturalHeight);
    }} />
  </span>;
}

function FeedCard({ card, workspaces, onOpen }: { card: FlowDelivery; workspaces: CreativeMaterialWorkspace[]; onOpen: (card: FlowDelivery) => void }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const format = formatOf(card);
  const material = materialCoverCandidates(workspaces);
  const seen = new Set(material.map((cover) => cover.fileId));
  const candidates = [...material, ...taskCoverCandidates(card).filter((cover) => !seen.has(cover.fileId))];
  return <article className="creative-feed-card">
    <button type="button" className={`creative-feed-media is-${frameOf(format)}`} style={ratio ? { aspectRatio: String(ratio) } : undefined} onClick={() => onOpen(card)} aria-label={`Abrir entrega ${card.title}`}>
      <FeedMedia key={candidates[0]?.fileId ?? "empty"} candidates={candidates} title={card.title} onRatio={setRatio} />
      <span className="creative-feed-open" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
    </button>
    <div className="creative-feed-caption">
      <div><strong title={card.title}>{card.title}</strong><small>{card.clientName}</small></div>
      {format ? <span className="creative-feed-format">{format}</span> : null}
    </div>
  </article>;
}

export default function CreativeFeedView({
  deliveries, workspaces, loading, error, onOpen,
}: {
  deliveries: FlowDelivery[];
  workspaces: CreativeMaterialWorkspace[];
  loading: boolean;
  error: boolean;
  onOpen: (card: FlowDelivery) => void;
}) {
  if (!deliveries.length) return <div className="creative-feed-zero">Nenhum Criativo para este filtro.</div>;

  const byCreative = new Map<string, CreativeMaterialWorkspace[]>();
  for (const workspace of workspaces) {
    const current = byCreative.get(workspace.creative_task_id) ?? [];
    current.push(workspace);
    byCreative.set(workspace.creative_task_id, current);
  }

  return <section className="creative-feed" aria-label="Feed de Criativos" aria-busy={loading}>
    <div className="creative-feed-heading"><span>{deliveries.length} criativo{deliveries.length === 1 ? "" : "s"}</span>{loading ? <small>Atualizando capas…</small> : error ? <small>Capas do Drive podem estar desatualizadas</small> : null}</div>
    <div className="creative-feed-grid">
      {deliveries.map((card) => <FeedCard key={card.id} card={card} workspaces={byCreative.get(card.id) ?? []} onOpen={onOpen} />)}
    </div>
  </section>;
}
