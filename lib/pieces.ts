// Peças: o que o cliente vê publicado (29/09/2026). O Feed junta DOIS mundos:
//
//   1. Entregas de criativo com fluxo de etapas (criativo, entrega_*). A capa é
//      o último arquivo em `final` do Drive (drive_assets); sem final, um link
//      de arquivo do Drive na própria entrega ou nas etapas.
//   2. Peças legadas, anteriores ao formato de Entrega: tarefas de Publicação,
//      Reels, Carrossel… sem fluxo (ex.: "REELS FEED - Jogando pratos novos",
//      40158eeb, uma tarefa comum de subtipo `reels` dentro de um plano). A capa
//      é o link de arquivo do Drive na descrição ou nos comentários.
//
// Etapas de uma entrega nunca viram peça própria — a entrega as representa.
// Função pura: o servidor passa as tarefas e os workspaces do Drive.

import { latestFinalCover, type CreativeMaterialWorkspace } from "./cardMaterials";
import { taskCoverCandidates } from "./taskCover";
import { deliveryDriveLinks } from "./deliveryLinks";
import { subtypeLabel } from "./taskCatalog";
import { isFlowDelivery, relationKindOf } from "./taskRelations";
import { isRecurrenceTemplate } from "./recurrenceState";
import type { TaskRecord } from "./validation";

export type PieceState = "concluida" | "atrasada" | "producao";
export type Piece = {
  id: string;
  title: string;
  clientName: string;
  clientSlug: string;
  format: string;
  /** Arquivos do Drive a tentar como capa, em ordem. */
  covers: string[];
  coverSource: "final" | "link";
  isVideo: boolean;
  legacy: boolean;
  state: PieceState;
  /** Publicação (legado), conclusão ou prazo — o que situa a peça no tempo. */
  date: string | null;
};

type PieceTask = TaskRecord & { clientName?: string; clientSlug?: string };

// Subtipos que são peça publicável. Os formatos do catálogo (lib/taskCatalog.ts,
// "Formatos de publicação") entram TODOS — "banner" faltava aqui e as imagens de
// TV da Baita (b761524f, subtipo banner) sumiam do Feed. `stories`/`post` ficam
// pelos cards antigos. Exportado para a rota filtrar com a mesma lista.
export const PIECE_FORMAT_SUBTYPES = ["reels", "story", "stories", "carrossel", "anuncio", "banner", "post"] as const;
export const LEGACY_PIECE_SUBTYPES = ["publicacao", "edicao", ...PIECE_FORMAT_SUBTYPES] as const;
const LEGACY_SUBTYPES = new Set<string>(LEGACY_PIECE_SUBTYPES);
const DELIVERY_KINDS = /^(criativo|entrega_)/;

function formatOf(task: TaskRecord): string {
  const stored = typeof task.payload?.formato === "string" ? task.payload.formato.trim() : "";
  if (stored) return stored;
  const fromKind = /^entrega_(\w+)/.exec(task.kind)?.[1];
  if (fromKind) return fromKind === "anuncio" ? "Anúncio" : fromKind[0].toUpperCase() + fromKind.slice(1);
  if (task.subtype && (PIECE_FORMAT_SUBTYPES as readonly string[]).includes(task.subtype)) return subtypeLabel(task.subtype);
  return /(reels?|stories?|carrossel|an[uú]ncio|banner)/i.exec(task.title)?.[0] ?? "";
}

function stateOf(task: TaskRecord, today: string): PieceState {
  if (task.completed_at || task.status === "aprovado") return "concluida";
  return task.due_date && task.due_date.slice(0, 10) < today ? "atrasada" : "producao";
}

const isStep = (task: TaskRecord) => (task.parents ?? []).some((link) => relationKindOf(link) === "workflow_step");

export function buildPieces(tasks: readonly PieceTask[], workspaces: readonly CreativeMaterialWorkspace[], today: string): Piece[] {
  const byCreative = new Map<string, CreativeMaterialWorkspace[]>();
  for (const workspace of workspaces) byCreative.set(workspace.creative_task_id, [...(byCreative.get(workspace.creative_task_id) ?? []), workspace]);
  const stepsOf = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    for (const link of task.parents ?? []) {
      if (relationKindOf(link) === "workflow_step") stepsOf.set(link.id, [...(stepsOf.get(link.id) ?? []), task]);
    }
  }

  const pieces: Piece[] = [];
  for (const task of tasks) {
    if (isRecurrenceTemplate(task) || isStep(task)) continue;
    const delivery = isFlowDelivery(task) && DELIVERY_KINDS.test(task.kind);
    const legacy = !task.workflow_version_id && (LEGACY_SUBTYPES.has(task.subtype ?? "") || task.kind === "criativo");
    if (!delivery && !legacy) continue;

    const format = formatOf(task);
    const final = delivery ? latestFinalCover(byCreative.get(task.id) ?? [], { carousel: /carrossel/i.test(format) }) : null;
    // Entrega: os links dela e das etapas, sem o que foi marcado para outra
    // Entrega que divide a mesma etapa, Edição mais recente primeiro
    // (lib/deliveryLinks.ts). Legado sem fluxo: os links do próprio card.
    const linked = delivery
      ? deliveryDriveLinks(task, stepsOf.get(task.id) ?? []).filter((link) => link.kind === "file").map((link) => link.id).slice(0, 8)
      : taskCoverCandidates(task).map((cover) => cover.fileId);
    const covers = [...new Set([...(final ? [final.drive_file_id] : []), ...linked])];
    if (!covers.length) continue; // só peça com imagem entra no Feed

    const published = typeof task.payload?.publicado_em === "string" ? task.payload.publicado_em : null;
    pieces.push({
      id: task.id,
      title: task.title,
      clientName: task.clientName ?? "",
      clientSlug: task.clientSlug ?? "",
      format,
      covers,
      coverSource: final ? "final" : "link",
      isVideo: Boolean(final?.mime_type.startsWith("video/")),
      legacy: !delivery,
      state: stateOf(task, today),
      date: published ?? task.completed_at?.slice(0, 10) ?? task.due_date ?? null,
    });
  }
  // Mais recentes primeiro; sem data, no fim.
  return pieces.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function pieceCounts(pieces: readonly Piece[]): Record<PieceState, number> {
  return {
    concluida: pieces.filter((piece) => piece.state === "concluida").length,
    atrasada: pieces.filter((piece) => piece.state === "atrasada").length,
    producao: pieces.filter((piece) => piece.state === "producao").length,
  };
}
