export type CreativeDriveIdentity = {
  clientId: string;
  routineTaskId: string | null;
  planTaskId: string;
  captureTaskId: string;
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

/** Final atual vence; sem ele, usa somente o Preview mais recente do Criativo. */
export function selectCreativeMaterialUrl(assets: MaterialAsset[], versions: MaterialVersion[]): string | null {
  const currentFinal = versions
    .filter((version) => version.state === "current")
    .sort((a, b) => b.version_number - a.version_number)
    .map((version) => assets.find((asset) => asset.id === version.asset_id && asset.state === "active" && asset.web_view_link))
    .find(Boolean);
  if (currentFinal?.web_view_link) return currentFinal.web_view_link;
  return assets
    .filter((asset) => asset.role === "preview" && asset.state === "active" && asset.web_view_link)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.web_view_link ?? null;
}
