// Caso de uso: copiar um arquivo do Google para os arquivos do cliente e, se for
// um documento, separar os roteiros para a diária.

import { getAdminClientDetail, getClient } from "@/lib/supabase";
import { importLinkIntoGed } from "@/lib/ged";
import type { GedArea } from "@/lib/ged/paths";
import { agencyToday } from "@/lib/time/agency";
import { HttpError } from "@/lib/validation";
import { parseScripts, type ParsedScript } from "./scriptParser";

export type ImportedClientFile = {
  document: { id: string; name: string; fileName: string | null };
  folderPath: string;
  sourceKind: string;
  text: string | null;
  scripts: ParsedScript[];
  driveCopy: { ok: boolean; reason?: string } | null;
};

export async function importClientFile(input: { slug: string; url: string; area?: GedArea }): Promise<ImportedClientFile> {
  const client = await getClient(input.slug, true);
  if (!client) throw new HttpError(404, "Cliente nao encontrado.");
  const detail = await getAdminClientDetail(input.slug);
  const result = await importLinkIntoGed({
    url: input.url,
    client: { id: client.id, slug: client.slug, name: client.name },
    area: input.area,
    driveRootFolderId: detail?.driveFolders.rootFolderId ?? null,
    today: agencyToday(),
  });
  return {
    document: { id: result.document.id, name: result.document.name, fileName: result.document.original_file_name },
    folderPath: result.folderPath,
    sourceKind: result.sourceKind,
    text: result.text,
    scripts: result.sourceKind === "document" && result.text ? parseScripts(result.text) : [],
    driveCopy: result.driveMirror,
  };
}
