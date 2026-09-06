import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteTaskType, updateTaskType } from "@/lib/taskTypes";
import { HttpError, taskTypePatchSchema } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH edita um tipo ou uma etapa: rotulo, ordem (reordenacao da cascata),
// prazo, peso, responsavel padrao, visibilidade para o cliente, ativo. A `key`
// nao entra no schema — ela e a identidade que tasks.kind/tasks.subtype
// guardam em texto.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const patch = taskTypePatchSchema.parse(await request.json());
    const supabase = await createClient();
    await updateTaskType(supabase, id, patch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

// DELETE remove uma etapa que nunca foi usada. Etapa com historico se desativa
// (PATCH active=false); tipo de topo nao se exclui.
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const supabase = await createClient();
    await deleteTaskType(supabase, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
