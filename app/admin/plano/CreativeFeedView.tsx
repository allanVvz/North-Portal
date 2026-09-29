"use client";

import { useState } from "react";
import { latestFinalCover, type CreativeMaterialAsset, type CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import type { FlowDelivery } from "@/lib/supabase";
import { operationState, parentOperationItem } from "../operacao/operationItems";

// O Feed mostra o que já tem o que publicar (29/09): criativos com arquivo em
// `final`, e a capa é o ÚLTIMO final anexado. Antes a capa caía para previews
// e links soltos do card, e o Feed misturava peça pronta com peça sem nada —
// uma parede de placeholders. Sem migração: a regra usa os arquivos que o Drive
// já registra (drive_assets).

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

const isPublishing = (card: FlowDelivery) => currentFlowStepOf(card.activities)?.subtype === "publicacao";

function FeedCard({ card, cover, today, onOpen }: { card: FlowDelivery; cover: CreativeMaterialAsset; today: string; onOpen: (card: FlowDelivery) => void }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const format = formatOf(card);
  const state = operationState(parentOperationItem(card), today);
  const video = cover.mime_type.startsWith("video/");
  return <article className="creative-feed-card">
    <button type="button" className={`creative-feed-media is-${frameOf(format)}`} style={ratio ? { aspectRatio: String(ratio) } : undefined} onClick={() => onOpen(card)} aria-label={`Abrir ${card.title}`}>
      {broken ? <span className="creative-feed-empty-media" aria-hidden="true">Miniatura indisponível</span> : (
        <span className="creative-feed-media-image">
          {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive */}
          <img src={`/api/admin/drive/thumbnail/${cover.drive_file_id}`} alt={`Capa de ${card.title}`} loading="lazy" decoding="async"
            onError={() => setBroken(true)}
            onLoad={(event) => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setRatio(naturalWidth / naturalHeight); }} />
        </span>
      )}
      <span className="creative-feed-badges">
        {isPublishing(card) ? <span className="creative-feed-badge is-publish">Publicação</span> : null}
        {video ? <span className="creative-feed-badge">▶ vídeo</span> : null}
      </span>
    </button>
    <div className="creative-feed-caption">
      <strong title={card.title}>{card.title}</strong>
      <span className="op-lean-state"><span className={`op-dot tone-${state.tone}`} aria-hidden /><b>{state.stage}</b>{state.detail ? <em>· {state.detail}</em> : null}</span>
      <small>{card.clientName}{format ? ` · ${format}` : ""} · final de {new Date(cover.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</small>
    </div>
  </article>;
}

export default function CreativeFeedView({
  deliveries, workspaces, loading, error, today, onOpen,
}: {
  deliveries: FlowDelivery[];
  workspaces: CreativeMaterialWorkspace[];
  loading: boolean;
  error: boolean;
  today: string;
  onOpen: (card: FlowDelivery) => void;
}) {
  const byCreative = new Map<string, CreativeMaterialWorkspace[]>();
  for (const workspace of workspaces) byCreative.set(workspace.creative_task_id, [...(byCreative.get(workspace.creative_task_id) ?? []), workspace]);

  const withCover = deliveries
    .map((card) => ({ card, cover: latestFinalCover(byCreative.get(card.id) ?? []) }))
    .filter((row): row is { card: FlowDelivery; cover: CreativeMaterialAsset } => row.cover !== null)
    // Em Publicação primeiro; depois o final mais recente.
    .sort((a, b) => Number(isPublishing(b.card)) - Number(isPublishing(a.card)) || b.cover.created_at.localeCompare(a.cover.created_at));
  const withoutCover = deliveries.length - withCover.length;

  return <section className="creative-feed" aria-label="Feed de criativos" aria-busy={loading}>
    <div className="creative-feed-heading">
      <span><b>{withCover.length}</b> {withCover.length === 1 ? "criativo com arquivo final" : "criativos com arquivo final"}</span>
      {withoutCover > 0 ? <small>{withoutCover} ainda sem final ficam fora</small> : null}
      {loading ? <small>Atualizando capas…</small> : error ? <small>Capas do Drive podem estar desatualizadas</small> : null}
    </div>
    {withCover.length ? (
      <div className="creative-feed-grid">
        {withCover.map(({ card, cover }) => <FeedCard key={card.id} card={card} cover={cover} today={today} onOpen={onOpen} />)}
      </div>
    ) : (
      <div className="creative-feed-zero">{loading ? "Buscando os arquivos finais no Drive…" : "Nenhum criativo com arquivo final ainda. A capa aparece quando o final é enviado na pasta do criativo."}</div>
    )}
  </section>;
}
