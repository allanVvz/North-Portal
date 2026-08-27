import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { updateMyProfile } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

// POST /api/admin/me/avatar — upload da própria foto de perfil.
//
// Via service role (bypassa RLS), não upload direto navegador->Storage como
// os documentos fazem: o bucket `avatars` tem uma anomalia de RLS reproduzida
// e documentada (ver commit) onde toda INSERT em storage.objects para este
// bucket é rejeitada mesmo com uma policy `with check (true)` — sem causa
// identificável após investigação extensa (mesma role, mesmo is_admin(),
// mesmo mecanismo que o bucket 'documents' usa com sucesso). Passar pelo
// servidor com a service role contorna o problema por completo em vez de
// deixar o upload quebrado esperando uma explicação.
export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Nenhum arquivo enviado.");
    if (file.size > MAX_AVATAR_SIZE_BYTES) throw new HttpError(400, "A imagem excede o limite de 5 MB.");
    const extension = ALLOWED_MIME[file.type];
    if (!extension) throw new HttpError(400, "Envie um arquivo PNG, JPEG ou WEBP.");

    const admin = createAdminClient();
    const path = `${session.userId}${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from(AVATAR_BUCKET).upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) throw new HttpError(503, "Não foi possível enviar a foto.");

    // Cache-bust: o path é fixo por perfil (upsert), então sem isso o browser
    // continuaria mostrando a foto antiga em cache após trocar.
    const { data } = admin.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;

    await updateMyProfile(session.userId, { avatar_url: avatarUrl });
    return NextResponse.json({ avatar_url: avatarUrl });
  } catch (error) {
    return apiError(error);
  }
}
