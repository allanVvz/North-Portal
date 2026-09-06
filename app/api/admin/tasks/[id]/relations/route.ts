import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getTaskById, linkTasks, slotIsTaken } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { findType, listTaskTypes } from "@/lib/taskTypes";
import { HttpError } from "@/lib/validation";

const bodySchema = z.object({
  child_id: z.string().uuid(),
  slot: z.string().max(40).nullable().optional(),
});

/** O order_index do subtipo `slot` dentro do tipo do pai -- a mesma ordem que a
 *  cascata grava no elo quando materializa a etapa sozinha (linkStep). Tipo ou
 *  subtipo desconhecido cai para 0: o elo ainda vale, so nao carrega ordem. */
async function slotOrderIndex(parentKind: string, slot: string): Promise<number> {
  const types = await listTaskTypes(await createClient());
  return findType(types, parentKind)?.subtypes.find((s) => s.key === slot)?.order_index ?? 0;
}

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

    // Uma etapa so aceita UM card. Sem esta trava, uma tela desatualizada
    // (mostrando o slot vazio depois de ja ter ligado algo) faz um segundo
    // clique criar um segundo elo no mesmo slot -- e a caixa de etapas renderiza
    // so o primeiro, entao o outro fica invisivel. Ja aconteceu em producao.
    if (slot && (await slotIsTaken(id, slot, child_id))) {
      throw new HttpError(409, "Esta etapa ja tem um card ligado.");
    }

    // A posicao do ELO e a ordem da etapa DENTRO da corrente -- o order_index
    // do subtipo no molde --, nao a posicao do card no quadro. Passar
    // `child.position` aqui (como era) fazia um card avulso anexado a mao
    // chegar com a posicao que tinha no Kanban: a etapa de edicao do "Evento
    // Baita 19/09" veio com -680, na frente do roteiro (-640), e o selo
    // passou a mostra-la como 1/4. Sem slot (membro de Plano de Acao) nao ha
    // corrente e a posicao nao significa nada -- fica 0.
    await linkTasks(id, child_id, slot ?? null, slot ? await slotOrderIndex(parent.kind, slot) : 0);
    return NextResponse.json(await getTaskById(child_id));
  } catch (error) {
    return apiError(error);
  }
}
