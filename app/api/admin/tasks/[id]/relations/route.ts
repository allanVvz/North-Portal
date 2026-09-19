import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getTaskById, linkTasks, workflowStepIsTaken } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { workflowByVersionId } from "@/lib/workflows";
import { HttpError } from "@/lib/validation";

const bodySchema = z.object({
  child_id: z.string().uuid(),
  workflow_step_id: z.string().uuid().nullable().optional(),
  relation_kind: z.enum(["structural_member", "workflow_step", "reference", "dependency"]),
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
    const { child_id, workflow_step_id: workflowStepId, relation_kind: relationKind } = bodySchema.parse(await request.json());
    if (child_id === id) throw new HttpError(400, "Um card nao pode ser pai de si mesmo.");

    const [parent, child] = await Promise.all([getTaskById(id), getTaskById(child_id)]);
    if (!parent || !child) throw new HttpError(404, "Card nao encontrado.");
    if (relationKind === "structural_member" && parent.client_id !== child.client_id) {
      if (parent.kind !== "plano_acao") throw new HttpError(403, "Somente um Plano de Ação pode reunir cards de outros clientes.");
      const admin = createAdminClient();
      const { data: parentClient, error: parentClientError } = await admin.from("clients").select("slug").eq("id", parent.client_id).maybeSingle();
      if (parentClientError) throw parentClientError;
      if (parentClient?.slug !== "north") throw new HttpError(403, "Somente Planos de Ação da ADM North podem reunir cards de outros clientes.");
    }
    if (relationKind === "workflow_step" && !workflowStepId) throw new HttpError(400, "Uma etapa de fluxo exige workflow_step_id.");
    if (relationKind !== "workflow_step" && workflowStepId) {
      throw new HttpError(400, "Somente uma etapa de fluxo pode ter workflow_step_id.");
    }
    if (relationKind === "workflow_step") {
      if (!parent.workflow_version_id) throw new HttpError(409, "A Entrega não possui uma versão de workflow.");
      const workflow = await workflowByVersionId(await createClient(), parent.workflow_version_id);
      const step = workflow?.steps.find((candidate) => candidate.workflow_step_id === workflowStepId);
      if (!step) throw new HttpError(409, "A etapa não pertence à versão desta Entrega.");
      if (child.task_type_id !== step.task_type_id) {
        throw new HttpError(400, "A etapa de workflow exige uma Tarefa do subtipo declarado.");
      }
    }

    // Uma etapa versionada aceita um único card neste pai. A unicidade é pela
    // FK, não pela projeção textual `slot` mantida para leitura legada.
    if (relationKind === "workflow_step" && workflowStepId && (await workflowStepIsTaken(id, workflowStepId, child_id))) {
      throw new HttpError(409, "Esta etapa ja tem um card ligado.");
    }

    await linkTasks(id, child_id, workflowStepId ?? null, relationKind);
    return NextResponse.json(await getTaskById(child_id));
  } catch (error) {
    return apiError(error);
  }
}
