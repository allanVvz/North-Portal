import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { resolveDriveItemKind } from "@/lib/googleDriveApi";

// GET /api/admin/drive/kind?id=… — este id do Drive é pasta ou arquivo?
//
// Existe porque `/open?id=…` serve para os dois e é a forma mais comum nos
// comentários dos cards. Sem esta resposta o card teria de adivinhar, e abrir
// um navegador de pastas em cima de um arquivo é pior do que não abrir nada.
//
// Ver resolveDriveItemKind para os dois caminhos de resolução.

const FILE_ID_RE = /^[a-zA-Z0-9_-]{10,200}$/;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!FILE_ID_RE.test(id)) return NextResponse.json({ kind: "unknown" });

    return NextResponse.json(
      { kind: await resolveDriveItemKind(id) },
      // O tipo de um item do Drive não muda: um arquivo não vira pasta. Vale
      // guardar por bastante tempo no navegador de quem perguntou — a rota é
      // autenticada por sessão de admin, daí `private`.
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
