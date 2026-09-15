// Guarda e recupera os previews de criativo usados pelos relatórios.
//
// A Automação 1 baixa as miniaturas (lib/reports/creativePreviews.ts) e grava no
// storage; o caminho vai para `traffic_reports.snapshot.previews`. A Automação 2
// lê do mesmo lugar — as duas pipelines mostram a MESMA imagem da mesma semana,
// e nenhuma depende de a URL assinada do Facebook ainda estar válida.

import { DOCUMENT_BUCKET } from "@/lib/documentFiles";
import {
  downloadImage, fetchCreativeMedia, imageMime, toDataUri,
  type PreviewAsset,
} from "@/lib/reports/creativePreviews";
import type { AdminClient } from "./taskAccess";

/** O que fica no snapshot: por anúncio, o caminho no storage e o link do post. */
export type StoredPreview = { path: string | null; permalink: string | null; objectType: string | null };

export async function collectAndStorePreviews(
  admin: AdminClient,
  token: string,
  clientSlug: string,
  periodTo: string,
  creatives: { adId: string; creativeId: string | null }[],
): Promise<{ stored: Record<string, StoredPreview>; assets: Record<string, PreviewAsset> }> {
  const stored: Record<string, StoredPreview> = {};
  const assets: Record<string, PreviewAsset> = {};
  const withCreative = creatives.filter((c): c is { adId: string; creativeId: string } => Boolean(c.creativeId));
  const media = await fetchCreativeMedia(token, withCreative.map((c) => c.creativeId));

  await Promise.all(withCreative.map(async ({ adId, creativeId }) => {
    const m = media.get(creativeId);
    const buf = m?.thumbnailUrl ? await downloadImage(m.thumbnailUrl) : null;
    let path: string | null = null;
    if (buf) {
      const ext = imageMime(buf) === "image/png" ? "png" : "jpg";
      path = `${clientSlug}/criativos/${periodTo}/${adId}.${ext}`;
      const { error } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, buf, { contentType: imageMime(buf) ?? "image/jpeg", upsert: true });
      if (error) path = null;
    }
    stored[adId] = { path, permalink: m?.permalink ?? null, objectType: m?.objectType ?? null };
    assets[adId] = { dataUri: buf ? toDataUri(buf) : null, permalink: m?.permalink ?? null, objectType: m?.objectType ?? null };
  }));
  return { stored, assets };
}

/** Relê os previews guardados para o relatório de resultados. */
export async function loadStoredPreviews(admin: AdminClient, stored: Record<string, StoredPreview> | undefined): Promise<Record<string, PreviewAsset>> {
  const out: Record<string, PreviewAsset> = {};
  if (!stored) return out;
  await Promise.all(Object.entries(stored).map(async ([adId, s]) => {
    let dataUri: string | null = null;
    if (s.path) {
      const { data } = await admin.storage.from(DOCUMENT_BUCKET).download(s.path);
      if (data) dataUri = toDataUri(Buffer.from(await data.arrayBuffer()));
    }
    out[adId] = { dataUri, permalink: s.permalink, objectType: s.objectType };
  }));
  return out;
}
