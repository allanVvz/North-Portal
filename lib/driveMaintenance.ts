// Manutenção do Drive das diárias (30/09/2026).
//
// Nasceu de um caso real: as diárias de 16 e 23/09 da Baita sumiram da vista
// da equipe. Ninguém apagou nada — as pastas, donas da conta de serviço,
// foram "removidas" no Drive por quem não é dono, o que só desfaz o vínculo
// com a pasta pai. Ficaram à vista duas cópias vazias do mesmo nome (criadas
// por uma execução antiga que não gravava os ids), e o banco seguia apontando
// para 131 brutos que já não existiam.
//
// Três verificações, sempre em SIMULAÇÃO; `apply` executa:
//   1. pastas registradas (diária, Roteiro, Captação) fora do lugar →
//      as que ficaram sem pai voltam para onde a preparação espera;
//   2. cópias vazias de uma diária registrada, sem registro no banco → lixeira
//      (só se não houver NENHUM arquivo dentro, em nenhum nível);
//   3. registros de arquivo (drive_assets ativos) cujo arquivo sumiu → `error`
//      (os que estão na lixeira só entram no relatório).
// Nada é apagado de verdade: lixeira do Drive e estado no banco se desfazem.

import type { createAdminClient } from "./supabase/admin";
import { addDriveParent, getDriveItemState, listFolderFilesPage, setDriveItemTrashed, type DriveItemState } from "./googleDriveApi";
import { recordedFolderAction } from "./creativeDriveModel";

type Db = ReturnType<typeof createAdminClient>;
const FOLDER = "application/vnd.google-apps.folder";
const DAILY_NAME = /^Bruto - diaria de gravacao/;
const SERIES_NAME = /^Diária de gravação/;

export type FolderCheck = {
  workspaceId: string; role: "diaria" | "roteiro" | "captacao"; id: string; name: string | null; status: string; action: string | null;
  /** Onde está hoje, quando não está no lugar: o caminho até onde a conta enxerga. */
  location?: string[];
};
export type DuplicateCheck = { id: string; name: string; parentId: string; action: string | null };
export type DriveMaintenanceReport = {
  apply: boolean;
  folders: FolderCheck[];
  duplicates: DuplicateCheck[];
  assets: { checked: number; missing: number; trashed: number; updated: number; sample: string[] };
  errors: string[];
};

async function childrenOf(folderId: string) {
  const out = [];
  let token: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const result = await listFolderFilesPage(folderId, 1000, token, true);
    out.push(...result.files);
    if (!result.nextPageToken) break;
    token = result.nextPageToken;
  }
  return out;
}

/** Nenhum arquivo em nenhum nível (só pastas vazias dentro). */
async function isEmptyTree(folderId: string, depth = 0): Promise<boolean> {
  if (depth > 3) return false;
  for (const child of await childrenOf(folderId)) {
    if (child.mimeType !== FOLDER) return false;
    if (!(await isEmptyTree(child.id, depth + 1))) return false;
  }
  return true;
}

async function inBatches<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let offset = 0; offset < items.length; offset += size) out.push(...await Promise.all(items.slice(offset, offset + size).map(run)));
  return out;
}

export async function runDriveMaintenance(db: Db, options: { apply: boolean }): Promise<DriveMaintenanceReport> {
  const report: DriveMaintenanceReport = { apply: options.apply, folders: [], duplicates: [], assets: { checked: 0, missing: 0, trashed: 0, updated: 0, sample: [] }, errors: [] };

  const [{ data: captures, error: capturesError }, { data: links, error: linksError }] = await Promise.all([
    db.from("drive_capture_workspaces").select("id,client_id,daily_folder_id,script_folder_id,capture_folder_id"),
    db.from("client_drive_links").select("client_id,raw_folder_id"),
  ]);
  if (capturesError) throw capturesError;
  if (linksError) throw linksError;
  const rawByClient = new Map(((links ?? []) as { client_id: string; raw_folder_id: string | null }[]).map((row) => [row.client_id, row.raw_folder_id]));

  // 1. Pastas registradas.
  const referencedDailies = new Map<string, string | null>(); // id -> nome
  for (const capture of (captures ?? []) as { id: string; client_id: string; daily_folder_id: string | null; script_folder_id: string | null; capture_folder_id: string | null }[]) {
    const raw = rawByClient.get(capture.client_id);
    if (!raw || !capture.daily_folder_id) continue;
    try {
      const daily = await getDriveItemState(capture.daily_folder_id);
      referencedDailies.set(daily.id, daily.name);
      // A diária mora na pasta Raw do cliente ou numa série "Diária de gravação · …" dentro dela.
      let seriesParent: string | null = null;
      if (daily.parents[0] && daily.parents[0] !== raw) {
        const parent = await getDriveItemState(daily.parents[0]);
        if (parent.state === "ok" && parent.parents.includes(raw) && SERIES_NAME.test(parent.name ?? "")) seriesParent = parent.id;
      }
      await checkFolder(report, options.apply, capture.id, "diaria", daily, seriesParent ?? raw, raw);
      for (const [role, id] of [["roteiro", capture.script_folder_id], ["captacao", capture.capture_folder_id]] as const) {
        if (id) await checkFolder(report, options.apply, capture.id, role, await getDriveItemState(id), daily.id);
      }
    } catch (error) {
      report.errors.push(`diária ${capture.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2. Cópias vazias de diárias registradas.
  const dailyNames = new Set([...referencedDailies.values()].filter((name): name is string => Boolean(name)));
  for (const raw of new Set([...rawByClient.values()].filter((id): id is string => Boolean(id)))) {
    try {
      const top = await childrenOf(raw);
      const parents = [raw, ...top.filter((item) => item.mimeType === FOLDER && SERIES_NAME.test(item.name ?? "")).map((item) => item.id)];
      for (const parentId of parents) {
        const candidates = parentId === raw ? top : await childrenOf(parentId);
        for (const folder of candidates) {
          if (folder.mimeType !== FOLDER || !DAILY_NAME.test(folder.name ?? "")) continue;
          if (referencedDailies.has(folder.id) || !dailyNames.has(folder.name ?? "")) continue;
          if (!(await isEmptyTree(folder.id))) {
            report.duplicates.push({ id: folder.id, name: folder.name ?? "", parentId, action: "mantida: tem arquivos" });
            continue;
          }
          if (options.apply) await setDriveItemTrashed(folder.id, true);
          report.duplicates.push({ id: folder.id, name: folder.name ?? "", parentId, action: options.apply ? "enviada para a lixeira" : "iria para a lixeira" });
        }
      }
    } catch (error) {
      report.errors.push(`cópias em ${raw}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Registros de arquivos que sumiram.
  const { data: assets, error: assetsError } = await db.from("drive_assets").select("id,drive_file_id,name").eq("state", "active");
  if (assetsError) throw assetsError;
  const rows = (assets ?? []) as { id: string; drive_file_id: string; name: string }[];
  const fileIds = [...new Set(rows.map((row) => row.drive_file_id))];
  const states = new Map<string, DriveItemState["state"]>();
  await inBatches(fileIds, 8, async (fileId) => {
    try { states.set(fileId, (await getDriveItemState(fileId)).state); } catch (error) { report.errors.push(`arquivo ${fileId}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  report.assets.checked = fileIds.length;
  const gone = rows.filter((row) => states.get(row.drive_file_id) === "missing" || states.get(row.drive_file_id) === "trashed");
  report.assets.missing = new Set(gone.filter((row) => states.get(row.drive_file_id) === "missing").map((row) => row.drive_file_id)).size;
  report.assets.trashed = new Set(gone.filter((row) => states.get(row.drive_file_id) === "trashed").map((row) => row.drive_file_id)).size;
  report.assets.sample = gone.slice(0, 5).map((row) => row.name);
  // Só o que SUMIU vira `error`. Arquivo na lixeira fica como está: pode ser
  // uma versão final que alguém tirou pelo próprio app e ainda vai restaurar.
  const missing = gone.filter((row) => states.get(row.drive_file_id) === "missing").map((row) => row.id);
  if (options.apply && missing.length) {
    const now = new Date().toISOString();
    for (let offset = 0; offset < missing.length; offset += 100) {
      const ids = missing.slice(offset, offset + 100);
      const { error } = await db.from("drive_assets").update({ state: "error", updated_at: now }).in("id", ids).eq("state", "active");
      if (error) report.errors.push(`marcar como sumido: ${error.message}`); else report.assets.updated += ids.length;
    }
  }
  return report;
}

async function checkFolder(report: DriveMaintenanceReport, apply: boolean, workspaceId: string, role: FolderCheck["role"], item: DriveItemState, parentId: string, legacyParentId?: string) {
  const decision = recordedFolderAction(item, parentId, legacyParentId);
  if (decision.action === "use") {
    report.folders.push({ workspaceId, role, id: item.id, name: item.name, status: "no lugar", action: null });
    return;
  }
  if (decision.action === "fail") {
    report.folders.push({ workspaceId, role, id: item.id, name: item.name, status: decision.message, action: "precisa de uma pessoa", location: await pathOf(item) });
    return;
  }
  if (apply) await addDriveParent(item.id, decision.parentId);
  report.folders.push({ workspaceId, role, id: item.id, name: item.name, status: "sem pasta pai (removida por quem não é dono)", action: apply ? `devolvida para ${decision.parentId}` : `voltaria para ${decision.parentId}` });
}

/** "Pasta avó / pasta mãe" até 4 níveis, para dizer onde uma pasta foi parar. */
async function pathOf(item: DriveItemState): Promise<string[]> {
  const path: string[] = [];
  let parentId = item.parents[0];
  for (let depth = 0; parentId && depth < 4; depth += 1) {
    const parent = await getDriveItemState(parentId);
    if (parent.state !== "ok") { path.unshift(`(${parent.state}) ${parentId}`); break; }
    path.unshift(`${parent.name} [${parent.id}]`);
    parentId = parent.parents[0];
  }
  return path;
}
