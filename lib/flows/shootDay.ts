// Executa a diária de gravação montada por shootDayRows (lib/flows/shootDayRows.ts).

import { notifyTaskParticipants, taskCreatedMessage } from "@/lib/notifications";
import { createTask, linkTasks, setTaskAssigneeProfiles } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { deliveryTypeProblem, findType, isDeliveryType, listTaskTypes } from "@/lib/taskTypes";
import { HttpError, type TaskRecord } from "@/lib/validation";
import { shootDayRows, type ShootDayPiece } from "./shootDayRows";
import { todayIso } from "./stepFields";

export type ShootDayInput = {
  clientId: string | null;
  typeKey: string;
  shootDate: string;
  planId: string | null;
  scriptTitle: string;
  scriptDescription: string | null;
  captureTitle: string;
  pieces: ShootDayPiece[];
  assignee: string | null;
  assigneeProfileIds?: string[];
};

export type ShootDayResult = { deliveries: TaskRecord[]; roteiro: TaskRecord; captacao: TaskRecord };

export async function createShootDay(input: ShootDayInput): Promise<ShootDayResult> {
  const supabase = await createClient();
  const type = findType(await listTaskTypes(supabase), input.typeKey);
  if (!type || !isDeliveryType(type)) throw new HttpError(400, "Este tipo nao e uma entrega.");
  const problem = deliveryTypeProblem(type);
  if (problem) throw new HttpError(400, problem);

  let rows;
  try {
    rows = shootDayRows({ ...input, type, today: todayIso(), deliveryIds: input.pieces.map(() => crypto.randomUUID()) });
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Diária inválida.");
  }

  const deliveries: TaskRecord[] = [];
  for (const row of rows.deliveries) deliveries.push(await createTask(input.clientId, row));
  const roteiro = await createTask(input.clientId, rows.roteiro);
  const captacao = await createTask(input.clientId, rows.captacao);
  for (const link of rows.links) await linkTasks(link.parentId, link.childId, link.slot, link.position);
  if (input.planId) {
    for (const delivery of deliveries) await linkTasks(input.planId, delivery.id);
  }
  if (input.assigneeProfileIds?.length) {
    for (const card of [...deliveries, roteiro, captacao]) await setTaskAssigneeProfiles(card.id, input.assigneeProfileIds);
  }
  await notifyTaskParticipants(roteiro.id, "task_created", taskCreatedMessage(roteiro.title));
  await notifyTaskParticipants(captacao.id, "task_created", taskCreatedMessage(captacao.title));
  return { deliveries, roteiro, captacao };
}
