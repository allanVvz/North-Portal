import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getTaskById, linkTasks } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

const bodySchema = z.object({
  child_id: z.string().uuid(),
  slot: z.string().max(40).nullable().optional(),
});

// POST /api/admin/tasks/[id]/relations -> liga um card EXISTENTE a este pai.
//
// E o botao de corrente: um mesmo roteiro pode servir varias pecas, uma diaria
// de gravacao pode servir varios criativos. Ligar compartilha o card, nao copia
// -- por isso e um elo em task_links e nao uma coluna no filho.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const { child_id, slot } = bodySchema.parse(await request.json());
    if (child_id === id) throw new HttpError(400, "Um card nao pode ser pai de si mesmo.");

    const [parent, child] = await Promise.all([getTaskById(id), getTaskById(child_id)]);
    if (!parent || !child) throw new HttpError(404, "Card nao encontrado.");
    // Uma etapa so encaixa no slot do proprio subtipo: ligar um roteiro na
    // etapa de edicao produziria uma corrente que nao quer dizer nada.
    if (slot && child.subtype !== slot) throw new HttpError(400, "Este card nao e do subtipo desta etapa.");

    await linkTasks(id, child_id, slot ?? null, child.position);
    return NextResponse.json(await getTaskById(child_id));
  } catch (error) {
    return apiError(error);
  }
}
