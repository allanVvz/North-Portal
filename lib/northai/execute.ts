// Caso de uso: executar um Blueprint confirmado pela pessoa.
//
// Cada operação passa pela MESMA porta do resto do portal (createTaskFromInput,
// createShootDay, createAutomationConfig). Sem transação de propósito: se uma
// operação falha, o que já nasceu fica e o resultado diz o que foi criado e onde
// parou — melhor do que um rollback silencioso que apagaria cards já
// notificados. Quando o harness com IA chegar (R4.11), ele produz Blueprints e
// chama esta mesma função: o executor não muda.

import { createAutomationConfig, getClient } from "@/lib/supabase";
import { createTaskFromInput } from "@/lib/tasks/createFromInput";
import { createShootDay } from "@/lib/flows/shootDay";
import { HttpError, taskCreateSchema } from "@/lib/validation";
import type { Blueprint, BlueprintResult } from "./blueprint";

export function blueprintNeedsManager(blueprint: Blueprint): boolean {
  return blueprint.ops.some((op) => op.op === "createAutomation");
}

export async function executeBlueprint(blueprint: Blueprint, actor: { userId: string }): Promise<BlueprintResult> {
  const client = blueprint.clientSlug ? await getClient(blueprint.clientSlug, true) : null;
  if (blueprint.clientSlug && !client) throw new HttpError(404, "Cliente nao encontrado.");

  const refs = new Map<string, string>();
  const created: BlueprintResult["created"] = [];
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
        const { formato, routineKey, ...task } = op.task;
        const payload = { ...(formato ? { formato } : {}), ...(routineKey ? { routine_key: routineKey } : {}) };
        const input = taskCreateSchema.parse({
          ...task,
          ...(blueprint.clientSlug ? { slug: blueprint.clientSlug } : {}),
          ...(Object.keys(payload).length ? { payload } : {}),
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
          actor.userId,
        );
        refs.set(op.ref, config.id);
        created.push({ ref: op.ref, kind: "automation", id: config.id, title: config.targetTask?.title ?? "Automação" });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao executar.";
    return { created, error: message };
  }
  return { created, error: null };
}
