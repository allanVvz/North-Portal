// Previews dos criativos para os relatórios em PDF.
//
// Verificado na API (15/09, anúncios reais da CRIS e da Baita):
// - `creative.thumbnail_url` padrão vem com 64×64 px — inutilizável;
// - `creative.image_url` vem vazio em vídeo e em post compartilhado (a maioria);
// - o NÓ do criativo com `thumbnail_width=600&thumbnail_height=600` devolve JPEG
//   600×600 de 33–52 KB, e `instagram_permalink_url` quando o post existe.
//
// A URL da imagem é assinada pelo Facebook e expira em dias. Por isso a imagem é
// BAIXADA na geração: o PDF nunca aponta para a URL do Facebook, e o relatório
// de resultados reusa o arquivo guardado pelo de anúncios.
//
// Nada aqui lança: preview que falha vira caixa neutra no PDF, nunca derruba o
// relatório.

import { GRAPH_VERSION } from "@/lib/meta";

export type CreativeMedia = { thumbnailUrl: string | null; permalink: string | null; objectType: string | null };

/** Chamadas simultâneas ao Graph. */
const CONCURRENCY = 6;

/** Miniatura grande + link do post, uma chamada por nó de criativo. O lote por
 *  `?ids=` foi aposentado pela Meta ("deprecated in v26.0+", verificado 15/09). */
export async function fetchCreativeMedia(token: string, creativeIds: string[], size = 600): Promise<Map<string, CreativeMedia>> {
  const out = new Map<string, CreativeMedia>();
  const queue = [...new Set(creativeIds.filter(Boolean))];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const qs = new URLSearchParams({
        fields: "thumbnail_url,instagram_permalink_url,object_type",
        thumbnail_width: String(size),
        thumbnail_height: String(size),
        access_token: token,
      });
      try {
        const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${id}?${qs}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const row = (await res.json()) as { thumbnail_url?: string; instagram_permalink_url?: string; object_type?: string };
        out.set(id, { thumbnailUrl: row.thumbnail_url ?? null, permalink: row.instagram_permalink_url ?? null, objectType: row.object_type ?? null });
      } catch {
        // criativo sem preview — sai com caixa neutra
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

/** Tipo pela assinatura do arquivo. O react-pdf só desenha JPEG e PNG. */
export function imageMime(buf: Buffer): "image/jpeg" | "image/png" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  return null;
}

export async function downloadImage(url: string, { maxBytes = 600_000, timeoutMs = 8000 } = {}): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > maxBytes || !imageMime(buf)) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function toDataUri(buf: Buffer): string | null {
  const mime = imageMime(buf);
  return mime ? `data:${mime};base64,${buf.toString("base64")}` : null;
}

/** O que o PDF recebe por criativo: a imagem já embutível e o link do post. */
export type PreviewAsset = { dataUri: string | null; permalink: string | null; objectType: string | null };
