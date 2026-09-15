import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createAutomationConfig, getClient } from "@/lib/supabase";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { HttpError, taskCreateSchema } from "@/lib/validation";
import { createTaskFromInput } from "@/lib/tasks/createFromInput";
import { createShootDay } from "@/lib/flows/shootDay";
import { blueprintSchema, type BlueprintCreated } from "@/lib/northai/blueprint";

export const runtime = "nodejs";

// POST /api/admin/northai/execute — executa um Blueprint do Estúdio, em ordem.
//
// Cada operação passa pela MESMA porta do resto do portal (createTaskFromInput,
// createShootDay, createAutomationConfig). Sem transação: se uma operação falha,
// o que já nasceu fica e a resposta diz o que foi criado e onde parou — melhor do
// que um rollback silencioso que apagaria cards já notificados.
export async function POST(request: Request) {
  try {
    const blueprint = blueprintSchema.parse((await request.json())?.blueprint);
    const needsManager = blueprint.ops.some((op) => op.op === "createAutomation");
    const session = needsManager ? await requireAdminManager() : await requireAdmin();
    const client = blueprint.clientSlug ? await getClient(blueprint.clientSlug, true) : null;
    if (blueprint.clientSlug && !client) throw new HttpError(404, "Cliente nao encontrado.");

    const refs = new Map<string, string>();
    const created: BlueprintCreated[] = [];
    const resolvePlan = (planRef?: string, planId?: string) => {
      if (planId) return planId;
      if (!planRef) return null;
      const id = refs.get(planRef);
      if (!id) throw new HttpError(400, `O plano "${planRef}" não foi criado antes desta etapa.`);
      return id;
    };

    try {
      for (const op of blueprint.ops) {
        if (op.op === "createTask") {
          const { formato, ...task } = op.task;
          const input = taskCreateSchema.parse({
            ...task,
            ...(blueprint.clientSlug ? { slug: blueprint.clientSlug } : {}),
            ...(formato ? { payload: { formato } } : {}),
            plan_id: resolvePlan(op.planRef, op.planId),
          });
          const result = await createTaskFromInput(input, op.scope);
          if (result.delivery) {
            refs.set(op.ref, result.delivery.id);
            created.push({ ref: op.ref, kind: "delivery", id: result.delivery.id, title: result.delivery.title });
            created.push({ ref: op.ref, kind: "step", id: result.task.id, title: result.task.title });
          } else {
            refs.set(op.ref, result.task.id);
            created.push({ ref: op.ref, kind: op.scope, id: result.task.id, title: result.task.title });
          }
        } else if (op.op === "createShootDay") {
          const result = await createShootDay({
            clientId: client?.id ?? null,
            typeKey: op.typeKey,
            shootDate: op.shootDate,
            planId: resolvePlan(op.planRef, op.planId),
            scriptTitle: op.scriptTitle,
            scriptDescription: op.scriptDescription,
            captureTitle: op.captureTitle,
            assignee: op.assignee,
            pieces: op.pieces.map((piece) => ({ ...piece, description: piece.description ?? null })),
          });
          refs.set(op.ref, result.roteiro.id);
          created.push({ ref: op.ref, kind: "step", id: result.roteiro.id, title: result.roteiro.title });
          created.push({ ref: op.ref, kind: "step", id: result.captacao.id, title: result.captacao.title });
          for (const delivery of result.deliveries) created.push({ ref: op.ref, kind: "delivery", id: delivery.id, title: delivery.title });
        } else {
          const targetTaskId = op.targetTaskId ?? (op.targetRef ? refs.get(op.targetRef) : undefined);
          if (!targetTaskId) throw new HttpError(400, "O card-alvo da automação não foi criado.");
          const config = await createAutomationConfig(
            { automationKey: op.automationKey, targetTaskId, performanceTemplateId: op.performanceTemplateId ?? null, active: true },
            session.userId,
          );
          refs.set(op.ref, config.id);
          created.push({ ref: op.ref, kind: "automation", id: config.id, title: config.targetTask?.title ?? "Automação" });
        }
      }
    } catch (error) {
      const message = error instanceof HttpError ? error.message : error instanceof Error ? error.message : "Falha ao executar.";
      return NextResponse.json({ created, error: message }, { status: created.length ? 207 : 422 });
    }

    return NextResponse.json({ created, error: null }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
