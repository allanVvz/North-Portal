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
 * O primeiro arquivo do Drive citado num texto.
 *
 * Só `kind: "file"` vira capa. Pasta, Docs, Sheets e Slides são links de
 * trabalho, não material publicável — virar capa deles deixaria o quadro cheio
 * de miniatura de planilha.
 */
function firstDriveFile(text: string): string | null {
  for (const url of linksIn(text)) {
    const link = parseGoogleDriveUrl(url);
    if (link?.kind === "file") return link.id;
  }
  return null;
}

/**
 * A capa de um card, ou null quando não há nenhum arquivo do Drive nele.
 *
 * A descrição vem antes dos comentários porque é o conteúdo do próprio card —
 * quem escreveu a tarefa e já anexou a referência ali está dizendo qual é o
 * material. Entre comentários, vale o mais antigo: a capa fica estável
 * conforme a thread cresce, em vez de trocar a cada comentário novo.
 */
export function taskCover(task: {
  description?: string | null;
  payload?: Record<string, unknown> | null;
}): TaskCover | null {
  const fromDescription = firstDriveFile(task.description ?? "");
  if (fromDescription) return { fileId: fromDescription, source: "description" };

  for (const comment of commentsOf(task.payload) as TaskComment[]) {
    const fromComment = firstDriveFile(comment.text);
    if (fromComment) return { fileId: fromComment, source: "comments" };
  }
  return null;
}
