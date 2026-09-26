import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getTaskById, linkTasks, listRelatedTasks, workflowStepIsTaken } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { workflowByVersionId } from "@/lib/workflows";
import { HttpError } from "@/lib/validation";
import { provisionCreativeDriveWorkspaceIfConfigured } from "@/lib/creativeDrive";
import { isCreativeDeliveryKind } from "@/lib/canonicalDeliveryFormats";
import { flowStepsOf } from "@/lib/taskRelations";

async function refreshCreativeFolders(creativeTaskId: string) {
  const db = createAdminClient();
  try { await provisionCreativeDriveWorkspaceIfConfigured(db, creativeTaskId); }
  catch (cause) { console.error("Falha ao preparar pastas do Criativo", cause); }
}

const bodySchema = z.object({
  child_id: z.string().uuid(),
  workflow_step_id: z.string().uuid().nullable().optional(),
  relation_kind: z.enum(["structural_member", "workflow_step", "reference", "dependency"]),
});
const replaceSchema = z.object({
  current_child_id: z.string().uuid(),
  child_id: z.string().uuid(),
  workflow_step_id: z.string().uuid(),
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
    let crossClient = false;
    if (relationKind === "structural_member" && parent.client_id !== child.client_id) {
      crossClient = true;
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
        throw new HttpError(400, `Escolha um card do subtipo ${step.label}.`);
      }
      const children = flowStepsOf(id, await listRelatedTasks(id));
      const previous = workflow!.steps.filter((candidate) => candidate.order_index < step.order_index)
        .find((candidate) => !children.some((task) => task.completed_at && task.parents.some((link) => link.id === id && link.workflow_step_id === candidate.workflow_step_id)));
      if (previous) throw new HttpError(409, `Conclua ${previous.label} antes de vincular ${step.label}.`);
    }

    // Uma etapa versionada aceita um único card neste pai. A unicidade é pela
    // FK, não pela projeção textual `slot` mantida para leitura legada.
    if (relationKind === "workflow_step" && workflowStepId && (await workflowStepIsTaken(id, workflowStepId, child_id))) {
      throw new HttpError(409, "Esta etapa ja tem um card ligado.");
    }

    await linkTasks(id, child_id, workflowStepId ?? null, relationKind, crossClient ? createAdminClient() : undefined);
    if (relationKind === "structural_member" && parent.kind === "plano_acao" && isCreativeDeliveryKind(child.kind)) await refreshCreativeFolders(child_id);
    if (relationKind === "workflow_step" && isCreativeDeliveryKind(parent.kind)) await refreshCreativeFolders(id);
    return NextResponse.json(await getTaskById(child_id));
  } catch (error) {
    return apiError(error);
  }
}

// UPDATE troca o filho da etapa em uma única instrução. A primeira etapa de
// uma Entrega não pode ficar vazia, por isso DELETE seguido de POST falhava.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "ID inválido.");
    const input = replaceSchema.parse(await request.json());
    if (id === input.child_id || input.current_child_id === input.child_id) throw new HttpError(400, "Escolha outro card para substituir esta etapa.");

    const [parent, current, replacement] = await Promise.all([
      getTaskById(id), getTaskById(input.current_child_id), getTaskById(input.child_id),
    ]);
    if (!parent || !current || !replacement) throw new HttpError(404, "Card não encontrado.");
    if (parent.client_id !== replacement.client_id) throw new HttpError(403, "A etapa precisa ser do mesmo cliente da Entrega.");
    if (!parent.workflow_version_id) throw new HttpError(409, "A Entrega não possui uma versão de workflow.");
    const workflow = await workflowByVersionId(await createClient(), parent.workflow_version_id);
    const step = workflow?.steps.find((candidate) => candidate.workflow_step_id === input.workflow_step_id);
    if (!step) throw new HttpError(409, "A etapa não pertence à versão desta Entrega.");
    if (replacement.task_type_id !== step.task_type_id) throw new HttpError(400, `Escolha um card do subtipo ${step.label}.`);
    if (!current.parents.some((link) => link.id === id && link.relation_kind === "workflow_step" && link.workflow_step_id === input.workflow_step_id)) {
      throw new HttpError(409, "A etapa foi alterada. Reabra o card e tente novamente.");
    }
    if (replacement.parents.some((link) => link.id === id)) throw new HttpError(409, "Este card já está vinculado à Entrega.");

    const db = await createClient();
    if (!replacement.completed_at) {
      const laterIds = workflow!.steps.filter((candidate) => candidate.order_index > step.order_index).map((candidate) => candidate.workflow_step_id);
      if (laterIds.length) {
        const { data: later, error: laterError } = await db.from("task_links").select("child_id")
          .eq("parent_id", id).eq("relation_kind", "workflow_step").in("workflow_step_id", laterIds).limit(1);
        if (laterError) throw laterError;
        if (later?.length) throw new HttpError(409, "Conclua o novo card antes de substituir uma etapa anterior às etapas já vinculadas.");
      }
    }
    const { data, error } = await db.from("task_links")
      .update({ child_id: input.child_id, status_override: null, completed_at_override: null, paused_from_status: null })
      .eq("parent_id", id)
      .eq("child_id", input.current_child_id)
      .eq("relation_kind", "workflow_step")
      .eq("workflow_step_id", input.workflow_step_id)
      .select("child_id").maybeSingle();
    if (error) throw new HttpError(409, error.message);
    if (!data) throw new HttpError(409, "A etapa foi alterada. Reabra o card e tente novamente.");
    if (isCreativeDeliveryKind(parent.kind)) await refreshCreativeFolders(id);
    const [previous, next] = await Promise.all([getTaskById(input.current_child_id), getTaskById(input.child_id)]);
    return NextResponse.json({ previous, current: next });
  } catch (error) {
    return apiError(error);
  }
}
