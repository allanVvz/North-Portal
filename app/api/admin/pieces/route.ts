import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { asTaskRecord } from "@/lib/automations/taskAccess";
import { buildPieces, LEGACY_PIECE_SUBTYPES, pieceCounts, type PieceState } from "@/lib/pieces";
import type { CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import { agencyToday } from "@/lib/time/agency";

// GET /api/admin/pieces?cliente=slug&estado=atrasada&limit=24 — as peças com
// imagem de capa (entregas com final no Drive e cards legados com link do
// Drive), para o Feed, o atalho da Home e a página do cliente. Ver lib/pieces.ts.
const LINKS = "task_links!task_links_child_id_fkey(parent_id,relation_kind,workflow_step_id,slot,position)";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const cliente = url.searchParams.get("cliente");
    const estado = url.searchParams.get("estado") as PieceState | null;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 500);
    const admin = createAdminClient();

    // Só o que pode ser peça (entrega de fluxo, criativo, subtipo de produção)
    // e as etapas das entregas, de onde sai a capa por link. Ler todas as
    // tarefas custava ~7s.
    const taskQuery = admin.from("tasks").select(`${TASK_COLUMNS},${LINKS},clients(name,slug,disabled,is_active)`)
      .is("recurrence_cadence", null)
      .or(`workflow_version_id.not.is.null,kind.eq.criativo,kind.like.entrega_%,subtype.in.(${[...LEGACY_PIECE_SUBTYPES, "captacao", "roteiro"].join(",")})`);
    const [tasksResult, workspacesResult] = await Promise.all([
      taskQuery,
      admin.from("drive_creative_workspaces").select("id,plan_task_id,capture_task_id,creative_task_id,status,assets:drive_assets!drive_assets_workspace_id_fkey(id,drive_file_id,name,mime_type,size_bytes,role,state,web_view_link,created_at),final_versions:drive_final_versions!drive_final_versions_workspace_id_fkey(id,asset_id,version_number,state,promoted_at)"),
    ]);
    if (tasksResult.error) throw tasksResult.error;
    if (workspacesResult.error) throw workspacesResult.error;
    type Client = { name: string; slug: string; disabled: boolean | null; is_active: boolean | null };
    type Row = Record<string, unknown> & { clients: Client | Client[] | null; task_links: { parent_id: string; relation_kind: string; workflow_step_id: string | null; slot: string | null; position: number | null }[] | null };
    const tasks = ((tasksResult.data ?? []) as unknown as Row[])
      .map((row) => ({ row, client: Array.isArray(row.clients) ? row.clients[0] : row.clients }))
      .filter(({ client }) => !client || (!client.disabled && client.is_active !== false))
      .filter(({ client }) => !cliente || client?.slug === cliente)
      .map(({ row, client }) => ({
        ...asTaskRecord(row),
        parents: (row.task_links ?? []).map((link) => ({ id: link.parent_id, relation_kind: link.relation_kind as never, workflow_step_id: link.workflow_step_id, slot: link.slot, position: link.position ?? 0 })),
        clientName: client?.name ?? "Sem cliente",
        clientSlug: client?.slug ?? "",
      }));
    const workspaces = ((workspacesResult.data ?? []) as unknown as CreativeMaterialWorkspace[]).map((workspace) => ({ ...workspace, raw_links: [] }));
    const all = buildPieces(tasks, workspaces, agencyToday());
    const pieces = (estado ? all.filter((piece) => piece.state === estado) : all).slice(0, limit);
    return NextResponse.json({ pieces, counts: pieceCounts(all), total: all.length });
  } catch (error) {
    return apiError(error);
  }
}
