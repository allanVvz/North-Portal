export type CreativeDriveIdentity = {
  clientId: string;
  routineTaskId: string | null;
  planTaskId: string;
  captureTaskId: string | null;
  creativeTaskId: string;
  stageTaskId: string | null;
};

/** Identidade da diaria: a Captacao, deliberadamente sem data. */
export function captureWorkspaceKey(identity: Pick<CreativeDriveIdentity, "planTaskId" | "captureTaskId">): string {
  return `${identity.planTaskId}:${identity.captureTaskId}`;
}

export function creativeDriveAppProperties(identity: CreativeDriveIdentity, role: string): Record<string, string> {
  const captureLevel = role === "daily_root" || role === "script" || role === "capture";
  return Object.fromEntries(Object.entries({
    client_id: identity.clientId,
    routine_task_id: identity.routineTaskId,
    plan_task_id: identity.planTaskId,
    capture_task_id: identity.captureTaskId,
    creative_task_id: captureLevel ? null : identity.creativeTaskId,
    stage_task_id: captureLevel ? null : identity.stageTaskId,
    north_role: role,
  }).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

export type MaterialAsset = { id: string; role: string; state: string; web_view_link: string | null; created_at: string };
export type MaterialVersion = { asset_id: string; state: string; version_number: number };

/** The client portal follows the same Home -> Preview folder priority. */
export function selectCreativeMaterialUrl(assets: MaterialAsset[], _versions: MaterialVersion[]): string | null {
  return assets
    .filter((asset) => (asset.role === "final" || asset.role === "preview") && asset.state === "active" && asset.web_view_link)
    .sort((a, b) => (a.role === b.role ? b.created_at.localeCompare(a.created_at) : a.role === "final" ? -1 : 1))[0]?.web_view_link ?? null;
}


/**
 * O que fazer com uma pasta registrada que a preparação reencontra (30/09):
 * usá-la, devolvê-la ao lugar, ou parar com uma explicação. "Fora do lugar"
 * por acidente é ficar sem pai ou na raiz da conta do app — é o que o Drive
 * faz quando alguém que não é dono a "remove" (diárias de 16 e 23/09).
 * Com outro pai não se mexe: no "Meu Drive" um item tem um pai só, e ele foi
 * movido de propósito.
 */
export function recordedFolderAction(
  item: { state: "ok" | "trashed" | "missing"; name: string | null; mimeType: string | null; parents: readonly string[] },
  parentId: string,
  legacyParentId?: string,
  /** "Meu Drive" da conta do app: é para lá que o Drive devolve o que alguém que não é dono "remove". */
  ownerRootId?: string | null,
): { action: "use" } | { action: "reattach"; parentId: string; removeParentId?: string } | { action: "fail"; status: number; message: string } {
  if (item.state === "missing") return { action: "fail", status: 502, message: "Uma pasta registrada foi apagada ou perdeu o acesso no Google Drive." };
  if (item.state === "trashed") return { action: "fail", status: 409, message: `A pasta "${item.name ?? "registrada"}" está na lixeira do Drive. Restaure-a para continuar.` };
  if (item.mimeType !== "application/vnd.google-apps.folder") return { action: "fail", status: 409, message: "Um item registrado como pasta deixou de ser pasta no Drive." };
  if (item.parents.some((parent) => parent === parentId || parent === legacyParentId)) return { action: "use" };
  if (!item.parents.length) return { action: "reattach", parentId: legacyParentId ?? parentId };
  if (ownerRootId && item.parents.every((parent) => parent === ownerRootId)) return { action: "reattach", parentId: legacyParentId ?? parentId, removeParentId: ownerRootId };
  return { action: "fail", status: 409, message: `A pasta "${item.name ?? "registrada"}" foi movida para outro lugar no Drive. Volte-a para a pasta do cliente para continuar.` };
}
