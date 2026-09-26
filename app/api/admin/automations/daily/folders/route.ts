import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdminManager } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureDriveFolder, getDriveItemMetadata, isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import { HttpError } from "@/lib/validation";

const inputSchema = z.object({ clientId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    await requireAdminManager();
    if (!isGoogleDriveConfigured()) throw new HttpError(503, "Conecte o Google Drive antes de preparar pastas.");
    const { clientId } = inputSchema.parse(await request.json());
    const db = createAdminClient();
    const [{ data: client, error: clientError }, { data: links, error: linksError }] = await Promise.all([
      db.from("clients").select("id,name,slug").eq("id", clientId).maybeSingle(),
      db.from("client_drive_links").select("root_folder_id,raw_folder_id,uploads_folder_id")
        .eq("client_id", clientId).maybeSingle(),
    ]);
    if (clientError) throw clientError;
    if (linksError) throw linksError;
    if (!client) throw new HttpError(404, "Cliente não encontrado.");
    const agencyRootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
    if (!agencyRootId) throw new HttpError(503, "Pasta principal da agência não configurada.");
    let rootId = links?.root_folder_id ?? null;
    if (!rootId && (links?.raw_folder_id || links?.uploads_folder_id)) {
      const existing = await getDriveItemMetadata(links.raw_folder_id ?? links.uploads_folder_id!);
      rootId = existing?.parents?.[0] ?? null;
    }
    if (!rootId) rootId = (await ensureDriveFolder({
      name: `${client.name} (${client.slug})`, parentId: agencyRootId,
      appProperties: { north_client_id: clientId, north_role: "client_root" },
    })).id;
    const root = await getDriveItemMetadata(rootId);
    if (!root || root.mimeType !== "application/vnd.google-apps.folder" ||
        !root.parents?.includes(agencyRootId)) {
      throw new HttpError(409, "A pasta principal do cliente não está acessível no Drive.");
    }
    const { data: owner, error: ownerError } = await db.from("client_drive_links")
      .select("client_id").eq("root_folder_id", root.id).neq("client_id", clientId).limit(1);
    if (ownerError) throw ownerError;
    if (owner?.length) throw new HttpError(409, "Esta pasta principal já pertence a outro cliente.");
    const folder = async (recordedId: string | null, name: string, role: string) => {
      if (recordedId) {
        const recorded = await getDriveItemMetadata(recordedId);
        if (!recorded || recorded.mimeType !== "application/vnd.google-apps.folder" ||
            !recorded.parents?.includes(root.id)) {
          throw new HttpError(409, `A pasta ${name} registrada não pertence ao cliente no Drive.`);
        }
        return recorded.id;
      }
      return (await ensureDriveFolder({ name, parentId: root.id,
        appProperties: { north_client_id: clientId, north_role: role } })).id;
    };
    const rawFolderId = await folder(links?.raw_folder_id ?? null, "Raw", "client_raw");
    const uploadsFolderId = await folder(links?.uploads_folder_id ?? null, "Edição", "client_editing");
    const { error: saveError } = await db.from("client_drive_links").upsert({
      client_id: clientId,
      root_folder_id: root.id,
      raw_folder_id: rawFolderId,
      uploads_folder_id: uploadsFolderId,
      uploads_url: `https://drive.google.com/drive/folders/${uploadsFolderId}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" });
    if (saveError) throw saveError;
    return NextResponse.json({ clientId, raw_folder_id: rawFolderId, uploads_folder_id: uploadsFolderId });
  } catch (error) {
    return apiError(error);
  }
}
