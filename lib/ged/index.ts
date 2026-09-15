// GED — entrada única. Um link do Google (Docs, Sheets, Slides, arquivo) enviado
// ao Estúdio é COPIADO para o armazenamento interno: a plataforma não depende de
// o arquivo original continuar existindo ou compartilhado.
//
// Provedor: Supabase Storage sempre (é a cópia que o portal lê); quando a conta
// de serviço do Drive está configurada, a cópia também vai para a pasta do
// cliente no Drive da plataforma (best-effort — falhar lá não desfaz a cópia
// interna). Ver docs/northai/skills/ged.md.

import { googleDriveAccessToken, isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import { parseGoogleDriveUrl, type GoogleDriveKind } from "@/lib/googleDrive";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/documentFiles";
import { HttpError, type DocumentRecord } from "@/lib/validation";
import { copyDriveFileInto } from "./drive";
import { gedAreaForDriveKind, gedFolderPath, googleExportPlan, type GedArea } from "./paths";
import { storeInGed } from "./storage";

export type GedImportResult = {
  document: DocumentRecord;
  /** Texto do Docs (txt) ou do Sheets (csv) — o que o Estúdio lê. */
  text: string | null;
  sourceKind: GoogleDriveKind;
  area: GedArea;
  folderPath: string;
  driveMirror: { ok: boolean; reason?: string } | null;
};

export function gedProviderName(): "drive" | "storage" {
  return isGoogleDriveConfigured() ? "drive" : "storage";
}

type Download = { body: Uint8Array; mime: string; fileName: string | null };

async function download(url: string, token: string | null): Promise<Download> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new HttpError(502, "Não consegui baixar o arquivo do Google agora. Tente de novo em instantes.");
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  // Arquivo não compartilhado: o Google responde com a página de login (HTML).
  if (!res.ok || type === "text/html") {
    throw new HttpError(422, "Não consegui copiar o arquivo: compartilhe como “Qualquer pessoa com o link” e tente de novo.");
  }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_DOCUMENT_SIZE_BYTES) throw new HttpError(413, "O arquivo passa de 50 MB.");
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  const raw = match?.[1] ?? match?.[2] ?? null;
  let fileName: string | null = null;
  if (raw) {
    try { fileName = decodeURIComponent(raw); } catch { fileName = raw; }
  }
  return { body, mime: type || "application/octet-stream", fileName };
}

export async function importLinkIntoGed(input: {
  url: string;
  client: { id: string; slug: string; name: string };
  area?: GedArea;
  taskId?: string | null;
  driveRootFolderId?: string | null;
  today: string;
}): Promise<GedImportResult> {
  const link = parseGoogleDriveUrl(input.url.trim());
  if (!link) throw new HttpError(400, "Cole um link do Google Docs, Sheets, Slides ou de um arquivo do Drive.");
  const plan = googleExportPlan(link);
  if (!plan) throw new HttpError(400, "Pastas não são copiadas por link — envie o link de cada arquivo.");
  const area = input.area ?? gedAreaForDriveKind(link.kind);
  const token = isGoogleDriveConfigured() ? await googleDriveAccessToken().catch(() => null) : null;

  const original = await download(plan.original.url, token);
  const text = plan.text ? new TextDecoder().decode((await download(plan.text.url, token)).body) : null;
  const extension = plan.original.extension;
  const baseName = original.fileName ?? `${link.kind === "spreadsheet" ? "Planilha" : link.kind === "document" ? "Documento" : "Arquivo"} ${input.today}`;
  const fileName = extension && !baseName.toLowerCase().endsWith(`.${extension}`) ? `${baseName}.${extension}` : baseName;

  const document = await storeInGed({
    client: input.client,
    area,
    fileName,
    body: original.body,
    mime: original.mime === "application/octet-stream" ? plan.original.mime : original.mime,
    taskId: input.taskId,
    today: input.today,
  });

  let driveMirror: GedImportResult["driveMirror"] = null;
  if (token && input.driveRootFolderId) {
    try {
      await copyDriveFileInto({ token, fileId: link.id, name: fileName, parentFolderId: input.driveRootFolderId });
      driveMirror = { ok: true };
    } catch (error) {
      driveMirror = { ok: false, reason: error instanceof Error ? error.message : "Falha ao copiar para o Drive." };
    }
  }

  return { document, text, sourceKind: link.kind, area, folderPath: gedFolderPath(input.client, area), driveMirror };
}
