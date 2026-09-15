// Provedor do GED sobre o Drive da plataforma (conta de serviço). Só entra em
// jogo quando GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON e GOOGLE_DRIVE_ROOT_FOLDER_ID
// existem — ver lib/googleDriveApi.ts.

import { HttpError } from "@/lib/validation";

/** Duplica um arquivo do Drive para dentro da pasta do cliente no GED. */
export async function copyDriveFileInto(input: { token: string; fileId: string; name: string; parentFolderId: string }): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/copy?supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, parents: [input.parentFolderId] }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(502, `O Drive recusou a cópia: ${res.status} ${detail.slice(0, 160)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new HttpError(502, "O Drive não devolveu o id da cópia.");
  return data.id;
}
