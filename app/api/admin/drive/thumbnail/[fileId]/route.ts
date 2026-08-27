import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { fetchDriveThumbnail } from "@/lib/googleDriveApi";

// GET /api/admin/drive/thumbnail/[fileId] — a capa de um card.
//
// O quadro tem dezenas de cards; resolver a capa de todos na consulta da lista
// custaria uma ida ao Drive por card antes de desenhar qualquer coisa. Em vez
// disso cada card aponta um <img> para cá com `loading="lazy"`: o navegador só
// pede a capa dos cards que aparecem na tela, e a rota responde uma imagem de
// verdade — cacheável como qualquer outra.
//
// 404 é resposta normal, não erro: arquivo que não é imagem nem vídeo, Drive
// não configurado, link quebrado. O card esconde a capa e fica como era antes.
// Ver plan/CARD-COVER-PREVIEW.md e lib/taskCover.ts.

// Ids do Drive são [A-Za-z0-9_-]. Validar aqui evita que qualquer coisa vinda
// da URL entre na chamada ao Drive.
const FILE_ID_RE = /^[a-zA-Z0-9_-]{10,200}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    await requireAdmin();
    const { fileId } = await params;
    if (!FILE_ID_RE.test(fileId)) return new NextResponse(null, { status: 404 });

    const thumbnail = await fetchDriveThumbnail(fileId);
    if (!thumbnail) return new NextResponse(null, { status: 404 });

    return new NextResponse(thumbnail.body, {
      status: 200,
      headers: {
        "Content-Type": thumbnail.contentType,
        // A miniatura de um arquivo do Drive praticamente não muda, e a rota é
        // autenticada por sessão de admin — daí `private`: fica no navegador de
        // quem pediu, nunca num cache compartilhado.
        "Cache-Control": "private, max-age=3600",
        // Diz ao card se a origem é vídeo (um frame) ou imagem, sem uma segunda
        // requisição. Hoje só serve para o rótulo de acessibilidade.
        "X-Drive-Kind": thumbnail.mimeType.startsWith("video/") ? "video" : "image",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
