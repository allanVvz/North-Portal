import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { isGoogleDriveConfigured, listFolderFiles } from "@/lib/googleDriveApi";

// GET /api/admin/drive/files?folderId=…&limit=… — o conteúdo de uma pasta.
//
// É a rota do navegador de pastas (app/admin/DriveBrowser.tsx): descer um nível
// é chamar isto de novo com o id da subpasta, e é por isso que ela devolve
// pastas e arquivos misturados, na ordem que o Drive dá (subpastas primeiro).
//
// `configured` é parte da resposta, não um detalhe: quando a conta de serviço
// não está montada o navegador não tem como listar nada e cai para o embed
// público do Google, que navega sozinho em pasta compartilhada. Sem esse campo
// o cliente não teria como distinguir "pasta vazia" de "integração desligada".
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId");
    const configured = isGoogleDriveConfigured();
    if (!folderId) return NextResponse.json({ configured, files: [] });

    const limit = Number(url.searchParams.get("limit") ?? "");
    return NextResponse.json({
      configured,
      files: await listFolderFiles(folderId, Number.isFinite(limit) && limit > 0 ? limit : 8),
    });
  } catch (error) {
    return apiError(error);
  }
}
