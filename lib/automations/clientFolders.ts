import { ensureDriveFolder, getDriveItemMetadata, isGoogleDriveConfigured, listFolderFilesPage } from "@/lib/googleDriveApi";
import { HttpError } from "@/lib/validation";
import type { AdminClient } from "./taskAccess";

const FOLDER = "application/vnd.google-apps.folder";

export async function ensureClientDriveRoot(admin: AdminClient, clientId: string): Promise<string> {
  if (!isGoogleDriveConfigured()) throw new HttpError(503, "Conecte o Google Drive antes de ativar a automação.");
  const agencyRoot = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
  if (!agencyRoot) throw new HttpError(503, "Pasta CLIENTES não configurada.");
  const [{ data: client, error: clientError }, { data: links, error: linkError }] = await Promise.all([
    admin.from("clients").select("id,name,slug").eq("id", clientId).maybeSingle(),
    admin.from("client_drive_links").select("root_folder_id").eq("client_id", clientId).maybeSingle(),
  ]);
  if (clientError) throw clientError;
  if (linkError) throw linkError;
  if (!client) throw new HttpError(404, "Cliente não encontrado.");
  let root = links?.root_folder_id as string | null ?? null;
  if (!root) {
    if (!client.name.toLowerCase().includes("tock fatal")) {
      throw new HttpError(409, "Vincule a Raiz existente do cliente na ficha antes de ativar a automação.");
    }
    root = (await ensureDriveFolder({ name: client.name, parentId: agencyRoot,
      appProperties: { north_client_id: clientId, north_role: "client_root" } })).id;
  }
  const metadata = await getDriveItemMetadata(root);
  if (!metadata || metadata.mimeType !== FOLDER || !metadata.parents?.includes(agencyRoot)) {
    throw new HttpError(409, "A Raiz do cliente precisa estar acessível dentro de CLIENTES.");
  }
  if (!links?.root_folder_id) {
    const { error } = await admin.from("client_drive_links").upsert({
      client_id: clientId, root_folder_id: root, updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" });
    if (error) throw error;
  }
  return root;
}

/** Reuses existing client folders; Tock's root is created only on activation. */
export async function ensureClientDailyFolders(admin: AdminClient, clientId: string): Promise<{ root: string; raw: string; editing: string }> {
  const root = await ensureClientDriveRoot(admin, clientId);
  const { data: links, error: linkError } = await admin.from("client_drive_links")
    .select("root_folder_id,raw_folder_id,uploads_folder_id").eq("client_id", clientId).maybeSingle();
  if (linkError) throw linkError;
  const children = (await listFolderFilesPage(root, 1000, null, true)).files.filter((item) => item.mimeType === FOLDER);
  const subfolder = async (recorded: string | null, labels: string[], role: string) => {
    if (recorded) {
      const folder = await getDriveItemMetadata(recorded);
      if (!folder || folder.mimeType !== FOLDER || !folder.parents?.includes(root!)) {
        throw new HttpError(409, `A pasta ${labels[0]} vinculada não pertence ao cliente.`);
      }
      return recorded;
    }
    const existing = children.filter((item) => labels.some((label) => item.name.toLowerCase() === label.toLowerCase()));
    if (existing.length > 1) throw new HttpError(409, `Há várias pastas ${labels[0]}; escolha uma na ficha do cliente.`);
    if (existing.length === 1) return existing[0].id;
    return (await ensureDriveFolder({ name: labels[0], parentId: root!,
      appProperties: { north_client_id: clientId, north_role: role } })).id;
  };
  const raw = await subfolder(links?.raw_folder_id ?? null, ["Brutos", "Raw"], "client_raw");
  const editing = await subfolder(links?.uploads_folder_id ?? null, ["Edição", "Edicao"], "client_editing");
  const { error } = await admin.from("client_drive_links").upsert({
    client_id: clientId, root_folder_id: root, raw_folder_id: raw, uploads_folder_id: editing,
    raw_url: `https://drive.google.com/drive/folders/${raw}`,
    uploads_url: `https://drive.google.com/drive/folders/${editing}`,
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });
  if (error) throw error;
  return { root, raw, editing };
}
