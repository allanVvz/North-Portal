import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdminManager } from "@/lib/supabase/auth";
import { getClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { driveFolderIdFromUrl } from "@/lib/googleDrive";
import { getDriveItemMetadata, listFolderFilesPage } from "@/lib/googleDriveApi";
import { HttpError, validateSlug } from "@/lib/validation";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const input = z.object({ root: z.string().max(500).nullable(), raw: z.string().max(500).nullable(), editing: z.string().max(500).nullable() });
const folderId = (value: string | null) => value?.trim()
  ? driveFolderIdFromUrl(value) ?? value.trim()
  : null;

async function clientFor(slug: string) {
  const client = await getClient(validateSlug(slug), true);
  if (!client) throw new HttpError(404, "Cliente não encontrado.");
  return client;
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdminManager();
    await clientFor((await context.params).slug);
    const agencyRootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
    if (!agencyRootId) throw new HttpError(503, "Pasta CLIENTES não configurada.");
    const rootId = folderId(new URL(request.url).searchParams.get("root"));
    const [roots, children] = await Promise.all([
      listFolderFilesPage(agencyRootId, 1000, null, true),
      rootId ? listFolderFilesPage(rootId, 1000, null, true) : Promise.resolve({ files: [] }),
    ]);
    return NextResponse.json({
      roots: roots.files.filter((item) => item.mimeType === FOLDER_MIME).map(({ id, name }) => ({ id, name })),
      children: children.files.filter((item) => item.mimeType === FOLDER_MIME).map(({ id, name }) => ({ id, name })),
    });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdminManager();
    const client = await clientFor((await context.params).slug);
    const values = input.parse(await request.json());
    const agencyRootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
    if (!agencyRootId) throw new HttpError(503, "Pasta CLIENTES não configurada.");
    const root = folderId(values.root);
    const raw = folderId(values.raw);
    const editing = folderId(values.editing);
    if (!root && (raw || editing)) throw new HttpError(400, "Escolha a Raiz antes das subpastas.");
    const checked = await Promise.all([root, raw, editing].map((id) => id ? getDriveItemMetadata(id) : Promise.resolve(null)));
    for (let index = 0; index < checked.length; index += 1) {
      const id = [root, raw, editing][index];
      if (id && (!checked[index] || checked[index]!.mimeType !== FOLDER_MIME)) {
        throw new HttpError(409, `${["Raiz", "Brutos", "Edição"][index]} não está acessível como pasta no Google Drive.`);
      }
    }
    if (root && !checked[0]?.parents?.includes(agencyRootId)) throw new HttpError(409, "A Raiz precisa estar dentro de CLIENTES.");
    if (raw && !checked[1]?.parents?.includes(root!)) throw new HttpError(409, "Brutos precisa estar dentro da Raiz do cliente.");
    if (editing && !checked[2]?.parents?.includes(root!)) throw new HttpError(409, "Edição precisa estar dentro da Raiz do cliente.");
    const db = createAdminClient();
    if (!root || !raw || !editing) {
      const { data: plans, error: planError } = await db.from("tasks")
        .select("id").eq("client_id", client.id).eq("kind", "plano_acao");
      if (planError) throw planError;
      const ids = (plans ?? []).map((plan) => plan.id as string);
      if (ids.length) {
        const { data: activeDaily, error: dailyError } = await db.from("automation_configs")
          .select("id").in("target_task_id", ids).eq("automation_key", "diaria_recorrente")
          .eq("active", true).limit(1);
        if (dailyError) throw dailyError;
        if (activeDaily?.length) throw new HttpError(409, "Este cliente tem diária ativa; mantenha Raiz, Brutos e Edição vinculados.");
      }
    }
    if (root) {
      const { data: other, error } = await db.from("client_drive_links").select("client_id")
        .eq("root_folder_id", root).neq("client_id", client.id).limit(1);
      if (error) throw error;
      if (other?.length) throw new HttpError(409, "Esta Raiz já está vinculada a outro cliente.");
    }
    const { error } = await db.from("client_drive_links").upsert({
      client_id: client.id, root_folder_id: root, raw_folder_id: raw,
      uploads_folder_id: editing,
      raw_url: raw ? `https://drive.google.com/drive/folders/${raw}` : null,
      uploads_url: editing ? `https://drive.google.com/drive/folders/${editing}` : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" });
    if (error) throw error;
    return NextResponse.json({ rootFolderId: root, rawFolderId: raw, uploadsFolderId: editing });
  } catch (error) { return apiError(error); }
}
