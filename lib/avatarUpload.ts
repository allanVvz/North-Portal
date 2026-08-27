import { createClient } from "./supabase/client";

// Upload direto do navegador para o bucket `avatars` (RLS: authenticated +
// is_admin() — ver migration 20260827000000). Mesmo padrão de
// lib/documentFiles.ts:uploadDocumentFile — sem rota de servidor no meio,
// só o token da própria sessão autoriza o storage.

export const AVATAR_BUCKET = "avatars";
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export function avatarStoragePath(profileId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = (dot > 0 ? fileName.slice(dot) : "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10) || ".jpg";
  // Sem uuid no nome: sobrescrever o arquivo do próprio perfil é o
  // comportamento certo (x-upsert true abaixo), não acumular versões.
  return `${profileId}${extension}`;
}

export async function uploadAvatarFile(file: File): Promise<string> {
  if (file.size > MAX_AVATAR_SIZE_BYTES) throw new Error("A imagem excede o limite de 5 MB.");
  if (!ALLOWED_MIME.has(file.type)) throw new Error("Envie um arquivo PNG, JPEG ou WEBP.");

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sua sessão expirou. Entre novamente para enviar a foto.");

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error("O armazenamento não está configurado.");

  const path = avatarStoragePath(session.user.id, file.name);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}/storage/v1/object/${AVATAR_BUCKET}/${encodedPath}`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.onerror = () => reject(new Error("Falha de rede durante o upload."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = "Não foi possível enviar a foto.";
        try { message = JSON.parse(xhr.responseText).message || message; } catch { /* invalid/non-JSON storage response */ }
        reject(new Error(message));
      }
    };
    xhr.send(file);
  });

  // Cache-bust: o path é fixo por perfil (upsert), então sem isso o browser
  // continuaria mostrando a foto antiga em cache após trocar.
  const publicUrl = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
  return `${publicUrl}?v=${Date.now()}`;
}
