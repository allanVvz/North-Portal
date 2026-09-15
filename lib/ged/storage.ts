// Provedor do GED sobre o Supabase Storage (bucket `documents`) — o que está
// ativo enquanto o Drive da plataforma não tem conta de serviço. Cada arquivo
// vira uma linha em `documents`, então aparece em Informações como qualquer
// documento do cliente.

import { createAdminClient } from "@/lib/supabase/admin";
import { createDocument } from "@/lib/supabase";
import { DOCUMENT_BUCKET } from "@/lib/documentFiles";
import { HttpError, type DocumentRecord } from "@/lib/validation";
import { gedStoragePath, type GedArea } from "./paths";

export async function storeInGed(input: {
  client: { id: string; slug: string };
  area: GedArea;
  fileName: string;
  body: Uint8Array;
  mime: string;
  taskId?: string | null;
  today: string;
}): Promise<DocumentRecord> {
  const admin = createAdminClient();
  const path = gedStoragePath(input.client.slug, input.area, input.fileName);
  const { error } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, input.body, { contentType: input.mime, upsert: false });
  if (error) throw new HttpError(502, `Não foi possível gravar no GED: ${error.message}`);
  return createDocument(input.client.id, {
    name: input.fileName.replace(/\.[a-z0-9]{1,8}$/i, ""),
    doc_type: "material",
    status: "compartilhado",
    storage_path: path,
    original_file_name: input.fileName,
    mime_type: input.mime,
    size_bytes: input.body.byteLength,
    doc_date: input.today,
    task_id: input.taskId ?? null,
  });
}
