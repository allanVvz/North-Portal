import { createDriveShortcut, ensureDriveDocument, ensureDriveFolder, getDriveItemMetadata } from "@/lib/googleDriveApi";
import { parseGoogleDriveUrl } from "@/lib/googleDrive";
import { dailyConfigSchema, HttpError } from "@/lib/validation";
import type { AdminClient } from "./taskAccess";

const DOC_MIME = "application/vnd.google-apps.document";

export type DailySeries = { folderId: string; docId: string; docUrl: string; docName: string };

/** A daily automation owns one general folder and one canonical script Doc.
 * A human may supply a Doc; otherwise Drive creates it once. Both paths use
 * the same Doc for every recording cycle of this automation. */
export async function ensureDailySeries(admin: AdminClient, configId: string): Promise<DailySeries> {
  const { data: row, error } = await admin.from("automation_configs")
    .select("id,target_task_id,daily_config,updated_at")
    .eq("id", configId).eq("automation_key", "diaria_recorrente").maybeSingle();
  if (error) throw error;
  if (!row?.daily_config) throw new HttpError(404, "Automação de diária não encontrada.");
  const config = dailyConfigSchema.parse(row.daily_config);
  const [{ data: plan, error: planError }, { data: links, error: linksError }] = await Promise.all([
    admin.from("tasks").select("id,title,client_id,kind").eq("id", row.target_task_id).maybeSingle(),
    admin.from("client_drive_links").select("raw_folder_id").eq("client_id", config.clientId).maybeSingle(),
  ]);
  if (planError) throw planError;
  if (linksError) throw linksError;
  if (!plan || plan.kind !== "plano_acao" || plan.client_id !== config.clientId || !links?.raw_folder_id) {
    throw new HttpError(409, "Configure o Plano e a pasta Raw do cliente antes de preparar a diária.");
  }
  const identity = { client_id: config.clientId, automation_config_id: configId };
  const folder = await ensureDriveFolder({
    name: `Diária de gravação · ${plan.title}`,
    parentId: links.raw_folder_id,
    appProperties: { ...identity, north_role: "daily_series_root" },
  });
  let docId: string;
  let docName: string;
  let docUrl: string;
  if (config.scriptDocUrl) {
    const parsed = parseGoogleDriveUrl(config.scriptDocUrl);
    if (parsed?.kind !== "document") throw new HttpError(400, "O roteiro canônico precisa ser um link do Google Docs.");
    const doc = await getDriveItemMetadata(parsed.id);
    if (!doc || doc.mimeType !== DOC_MIME) {
      throw new HttpError(409, "O Google Doc informado precisa estar acessível à integração do Drive.");
    }
    docId = doc.id;
    docName = doc.name;
    docUrl = `https://docs.google.com/document/d/${doc.id}/edit`;
    if (!doc.parents?.includes(folder.id)) {
      await createDriveShortcut({ name: doc.name, parentId: folder.id, targetId: doc.id,
        appProperties: { ...identity, north_role: "daily_series_script_shortcut", document_id: doc.id } });
    }
  } else {
    const doc = await ensureDriveDocument({
      name: `Roteiro da diária · ${plan.title}`,
      parentId: folder.id,
      appProperties: { ...identity, north_role: "daily_series_script" },
    });
    docId = doc.id;
    docName = doc.name;
    docUrl = `https://docs.google.com/document/d/${doc.id}/edit`;
  }
  // Preserve concurrent edits to pieces while recording both Drive links.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error: currentError } = await admin.from("automation_configs")
      .select("daily_config,updated_at").eq("id", configId).maybeSingle();
    if (currentError) throw currentError;
    if (!current?.daily_config) throw new HttpError(404, "Automação de diária não encontrada.");
    const latest = dailyConfigSchema.parse(current.daily_config);
    if (latest.scriptDocUrl && latest.scriptDocUrl !== config.scriptDocUrl && latest.scriptDocUrl !== docUrl) {
      // A human selected a different Doc while the Drive operation was running.
      return ensureDailySeries(admin, configId);
    }
    if (latest.scriptDocUrl === docUrl && latest.seriesFolderId === folder.id) break;
    const { data: saved, error: saveError } = await admin.from("automation_configs")
      .update({ daily_config: { ...latest, scriptDocUrl: docUrl, seriesFolderId: folder.id } })
      .eq("id", configId).eq("updated_at", current.updated_at)
      .select("id").maybeSingle();
    if (saveError) throw saveError;
    if (saved) break;
    if (attempt === 2) throw new HttpError(409, "A configuração da diária mudou durante a criação do Doc; tente novamente.");
  }
  return { folderId: folder.id, docId, docUrl, docName };
}
