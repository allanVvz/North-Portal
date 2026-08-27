// Upload da foto de perfil via /api/admin/me/avatar (service role no servidor).
//
// Não é upload direto navegador->Storage como lib/documentFiles.ts faz —
// investigação reproduziu uma anomalia de RLS específica do bucket `avatars`:
// toda INSERT em storage.objects para ele é rejeitada por RLS mesmo com uma
// policy `with check (true)` (sempre verdadeira), na mesma role/is_admin()
// que funciona normalmente para o bucket `documents`. Sem causa identificável
// nos catálogos do Postgres (policies, triggers, event triggers, RLS da
// tabela buckets — tudo idêntico ao padrão que já funciona). Passar pelo
// servidor com a service role bypassa RLS por completo e contorna o problema.

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadAvatarFile(file: File): Promise<string> {
  if (file.size > MAX_AVATAR_SIZE_BYTES) throw new Error("A imagem excede o limite de 5 MB.");
  if (!ALLOWED_MIME.has(file.type)) throw new Error("Envie um arquivo PNG, JPEG ou WEBP.");

  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/admin/me/avatar", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Não foi possível enviar a foto.");
  }
  const data = (await res.json()) as { avatar_url: string };
  return data.avatar_url;
}
