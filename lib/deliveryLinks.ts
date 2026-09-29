// Os arquivos de uma Entrega SEM a automação de pastas (30/09/2026).
//
// Entregas legadas (ex.: Reels e Carrossel do "Evento Baita 10/10") não têm
// workspace no Drive: os arquivos chegam como links colados na descrição ou
// nos comentários — da própria Entrega ou das etapas. Esta é a leitura única
// desses links, usada pela capa e pelo Feed (lib/pieces.ts) e pela caixa de
// Arquivos do modal.
//
// Regras:
//   - uma etapa COMPARTILHADA entre Entregas (a mesma Edição para Reels e
//     Carrossel) tem comentários marcados com `for_task_id`; o marcado para
//     outra Entrega não entra aqui. Sem marca (comentário antigo), entra;
//   - ordem: Edição (mais recente primeiro, é onde chega o final), a própria
//     Entrega, outras etapas, Roteiro e por último Captação (bruto);
//   - cada arquivo uma vez, na primeira posição em que aparece.
// Função pura: quem chama decide se o link é arquivo ou pasta de fato
// (`/open?id=` serve para os dois — ver /api/admin/drive/kind).

import { commentsOf, splitCommentText } from "./comments";
import { parseGoogleDriveUrl } from "./googleDrive";

type Card = { id: string; subtype?: string | null; description?: string | null; payload?: Record<string, unknown> | null; created_at?: string | null };

export type DeliveryLink = {
  /** Id do item no Drive (arquivo ou pasta). */
  id: string;
  /** "folder" quando o link é de pasta; "file" é o palpite para `/file/d/` e `/open?id=`. */
  kind: "file" | "folder";
  /** Card onde o link foi colado. */
  cardId: string;
  /** edicao, captacao, roteiro… ou "entrega". */
  source: string;
  at: string | null;
};

const RANK: Record<string, number> = { edicao: 0, entrega: 1, roteiro: 8, captacao: 9 };
const rankOf = (source: string) => RANK[source] ?? 5;

function linksIn(text: string): { id: string; kind: "file" | "folder" }[] {
  const out: { id: string; kind: "file" | "folder" }[] = [];
  for (const part of splitCommentText(text)) {
    if (!("url" in part)) continue;
    const link = parseGoogleDriveUrl(part.url);
    if (link?.kind === "file" || link?.kind === "folder") out.push({ id: link.id, kind: link.kind });
  }
  return out;
}

function linksOf(card: Card, source: string, deliveryId: string): DeliveryLink[] {
  const out: DeliveryLink[] = [];
  const comments = commentsOf(card.payload ?? {})
    .filter((comment) => !comment.for_task_id || comment.for_task_id === deliveryId)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at));
  for (const comment of comments) for (const link of linksIn(comment.text)) out.push({ ...link, cardId: card.id, source, at: comment.at });
  for (const link of linksIn(card.description ?? "")) out.push({ ...link, cardId: card.id, source, at: card.created_at ?? null });
  return out;
}

export function deliveryDriveLinks(delivery: Card, steps: readonly Card[]): DeliveryLink[] {
  const all = [
    ...linksOf(delivery, "entrega", delivery.id),
    ...steps.flatMap((step) => linksOf(step, step.subtype || "etapa", delivery.id)),
  ];
  // Estável: dentro da mesma origem, mantém a ordem (mais recente primeiro).
  const ordered = all.map((link, index) => ({ link, index })).sort((a, b) => rankOf(a.link.source) - rankOf(b.link.source) || a.index - b.index).map(({ link }) => link);
  const seen = new Set<string>();
  return ordered.filter((link) => (seen.has(link.id) ? false : (seen.add(link.id), true)));
}
