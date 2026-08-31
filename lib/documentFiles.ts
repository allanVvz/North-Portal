import { createClient } from "./supabase/client";

export const DOCUMENT_BUCKET = "documents";
export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024;

export function sanitizeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const cleanBase = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "arquivo";
  const cleanExtension = extension.replace(/[^a-z0-9.]/g, "").slice(0, 20);
  return `${cleanBase.slice(0, 160)}${cleanExtension}`;
}

export function documentStoragePath(clientSlug: string, fileName: string, id = crypto.randomUUID()): string {
  return `${clientSlug}/${id}/${sanitizeFileName(fileName)}`;
}

// Trilhas North são globais (não pertencem a um cliente), então o primeiro
// segmento é uma pasta fixa em vez do slug do cliente. Continua com 3 segmentos,
// que é o que o storagePathSchema exige, e cai na mesma RLS por bucket_id.
export function trilhaStoragePath(fileName: string, id = crypto.randomUUID()): string {
  return `north-trilhas/${id}/${sanitizeFileName(fileName)}`;
}

export function fileTypeLabel(file: Pick<File, "name" | "type"> | { original_file_name: string | null; mime_type: string | null }): string {
  const name = "name" in file ? file.name : file.original_file_name ?? "";
  const mime = "type" in file ? file.type : file.mime_type ?? "";
  const extension = name.includes(".") ? name.split(".").pop()?.toUpperCase() : "";
  if (extension && extension.length <= 8) return extension;
  if (mime) return mime.split("/").pop()?.split("+")[0].toUpperCase() || "ARQ";
  return "ARQ";
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type DocumentPreviewKind = "pdf" | "image" | "video" | "audio" | "text" | "unsupported";

export function documentPreviewKind(file: {
  file_url: string | null;
  original_file_name: string | null;
  mime_type: string | null;
}): DocumentPreviewKind {
  const mime = file.mime_type?.toLowerCase() ?? "";
  let name = file.original_file_name ?? "";
  if (!name && file.file_url) {
    try { name = new URL(file.file_url).pathname; } catch { name = file.file_url; }
  }
  const extension = name.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(extension)) return "image";
  if (mime.startsWith("video/") || ["mp4", "webm", "ogv", "mov"].includes(extension)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extension)) return "audio";
  if (mime.startsWith("text/") || ["txt", "csv", "json", "xml", "md", "log", "html", "htm"].includes(extension)) return "text";
  return "unsupported";
}

// A "Trilha" (Informações → Trilhas North) is just a regular document whose
// file happens to be HTML — client-side distinction only, no schema change:
// avoids a new doc_type/migration for what is, for now, purely a different
// filtered view over the same `documents` table.
export function isHtmlDocument(file: { original_file_name: string | null; mime_type: string | null }): boolean {
  const mime = file.mime_type?.toLowerCase() ?? "";
  const name = file.original_file_name ?? "";
  const extension = name.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  return mime === "text/html" || extension === "html" || extension === "htm";
}

export async function uploadDocumentFile(file: File, path: string, onProgress: (percent: number) => void): Promise<string> {
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) throw new Error("O arquivo excede o limite de 50 MB.");
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sua sessão expirou. Entre novamente para enviar o arquivo.");

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error("O armazenamento não está configurado.");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}/storage/v1/object/${DOCUMENT_BUCKET}/${encodedPath}`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Falha de rede durante o upload."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = "Não foi possível enviar o arquivo.";
        try { message = JSON.parse(xhr.responseText).message || message; } catch { /* invalid/non-JSON storage response */ }
        reject(new Error(message));
      }
    };
    xhr.send(file);
  });

  onProgress(100);
  return supabase.storage.from(DOCUMENT_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function removeDocumentFile(path: string): Promise<void> {
  const { error } = await createClient().storage.from(DOCUMENT_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
