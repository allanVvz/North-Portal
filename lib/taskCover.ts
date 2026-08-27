import { commentsOf, splitCommentText, type TaskComment } from "./comments";
import { parseGoogleDriveUrl } from "./googleDrive";

// A capa do card: a primeira imagem/vídeo do Drive que aparece no card.
//
// Ninguém escolhe a capa hoje — ela é deduzida do que já está lá. Um link do
// Drive colado na descrição ou num comentário é a única fonte, e o primeiro
// que aparecer ganha. Ver plan/CARD-COVER-PREVIEW.md para o desenho completo,
// inclusive a fase de escolher a capa à mão, que ainda não existe.
//
// Este módulo é PURO e roda no cliente: ele só sabe que existe um arquivo do
// Drive com aquele id. Se o arquivo é imagem, vídeo ou planilha, quem decide é
// o servidor — /api/admin/drive/thumbnail/[fileId] devolve miniatura só para
// imagem e vídeo, e 404 para o resto, e o card esconde a capa no 404. Assim o
// quadro não precisa carregar metadado de dezenas de arquivos para desenhar.

/** Ordem de busca da capa. Documentada porque é uma escolha, não um acaso. */
export const COVER_SOURCE_ORDER = ["description", "comments"] as const;

export type TaskCover = {
  /** Id do arquivo no Drive — a rota de miniatura recebe isto. */
  fileId: string;
  /** Onde o link foi encontrado, para depuração e para a futura tela de escolha. */
  source: (typeof COVER_SOURCE_ORDER)[number];
};

/** Todos os links de um texto, na ordem em que aparecem. */
function linksIn(text: string): string[] {
  const urls: string[] = [];
  for (const part of splitCommentText(text)) {
    if ("url" in part) urls.push(part.url);
  }
  return urls;
}

/**
 * Os arquivos do Drive citados num texto, na ordem em que aparecem.
 *
 * Só `kind: "file"` vira capa. Pasta, Docs, Sheets e Slides são links de
 * trabalho, não material publicável — virar capa deles deixaria o quadro cheio
 * de miniatura de planilha.
 */
function driveFilesIn(text: string): string[] {
  const ids: string[] = [];
  for (const url of linksIn(text)) {
    const link = parseGoogleDriveUrl(url);
    if (link?.kind === "file" && !ids.includes(link.id)) ids.push(link.id);
  }
  return ids;
}

/**
 * Quantos candidatos o card tenta antes de desistir da capa.
 *
 * Existe um teto porque cada candidato que falha é uma requisição perdida.
 * Seis cobre com folga os cards reais (o maior hoje tem 4 arquivos) sem deixar
 * um card com 30 anexos disparar 30 pedidos.
 */
export const MAX_COVER_CANDIDATES = 6;

/**
 * Os candidatos a capa, do melhor para o pior.
 *
 * É uma LISTA, e não um só, porque nem todo arquivo do Drive rende miniatura:
 * pode não estar compartilhado, pode ter sido apagado, pode ser um formato sem
 * prévia. Medido nos dados reais de produção, a maioria dos arquivos colados
 * nos comentários não é pública — se o card apostasse tudo no primeiro link,
 * ficaria sem capa mesmo tendo três arquivos perfeitamente exibíveis logo
 * abaixo. O card tenta em ordem e para no primeiro que responder.
 *
 * A ordem: descrição antes dos comentários, porque a descrição é o conteúdo do
 * próprio card — quem escreveu a tarefa e já anexou a referência ali está
 * dizendo qual é o material. Entre comentários, vale o mais antigo, para a capa
 * ficar estável conforme a thread cresce em vez de trocar a cada comentário.
 */
export function taskCoverCandidates(task: {
  description?: string | null;
  payload?: Record<string, unknown> | null;
}): TaskCover[] {
  const candidates: TaskCover[] = [];
  const seen = new Set<string>();

  const push = (fileId: string, source: TaskCover["source"]) => {
    if (seen.has(fileId) || candidates.length >= MAX_COVER_CANDIDATES) return;
    seen.add(fileId);
    candidates.push({ fileId, source });
  };

  for (const id of driveFilesIn(task.description ?? "")) push(id, "description");
  for (const comment of commentsOf(task.payload) as TaskComment[]) {
    for (const id of driveFilesIn(comment.text)) push(id, "comments");
  }
  return candidates;
}

/** O primeiro candidato, ou null. Conveniência para quem só quer saber se há capa. */
export function taskCover(task: {
  description?: string | null;
  payload?: Record<string, unknown> | null;
}): TaskCover | null {
  return taskCoverCandidates(task)[0] ?? null;
}
