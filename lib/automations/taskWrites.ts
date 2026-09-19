// As duas únicas formas de uma automação escrever numa tarefa que um humano
// também mexe: payload atômico e status por compare-and-set.
//
// Existe porque o padrão anterior — ler a tarefa, gerar o relatório (Windsor,
// previews, PDF: segundos), montar o `payload` em memória e sobrescrevê-lo
// inteiro — apagava qualquer comentário humano gravado nesse intervalo, e um
// `.update({ status })` sem filtro de origem desfazia uma conclusão humana
// (o trigger tasks_sync_completed_at limpa `completed_at` ao sair de
// aprovado). Ver docs/reporting/report-pipeline.md, "Roteamento de comentários
// e escrita atômica".

import { TASK_COLUMNS } from "@/lib/taskColumns";
import type { TaskRecord, TaskStatus } from "@/lib/validation";
import { asTaskRecord, AUTOMATION_AUTHOR, type AdminClient } from "./taskAccess";

export type PayloadUpdate = {
  /** Texto do comentário a acrescentar ao FIM do thread que está no banco agora. */
  text?: string;
  /** Chave idempotente: a mesma ação re-executada não repete o comentário. */
  commentId?: string;
  author?: string;
  /** Chaves a mesclar no payload (nunca `comments`). */
  patch?: Record<string, unknown>;
  /** Chaves a remover do payload (nunca `comments`). */
  remove?: readonly string[];
};

export type PayloadUpdateResult = {
  /** `true` só quando este chamada acrescentou o comentário. */
  inserted: boolean;
  task: TaskRecord;
};

/** Id determinístico de um comentário de automação: a mesma ação sobre o mesmo
 * alvo produz o mesmo id, então retry e re-execução não duplicam. */
export function automationCommentId(...parts: ReadonlyArray<string | number>): string {
  return parts.join(":");
}

/**
 * Mescla/remove chaves de `payload` e acrescenta no máximo um comentário, tudo
 * num único UPDATE no banco (RPC `automation_task_payload_update`, sob lock da
 * linha). Nunca reenvia uma cópia lida antes: o que um humano gravou no meio
 * tempo sobrevive.
 *
 * Devolve `null` quando a tarefa não existe.
 */
export async function updateTaskPayload(
  admin: AdminClient,
  taskId: string,
  update: PayloadUpdate,
): Promise<PayloadUpdateResult | null> {
  const { data, error } = await admin.rpc("automation_task_payload_update", {
    p_task_id: taskId,
    p_comment_text: update.text ?? null,
    p_comment_id: update.commentId ?? null,
    p_comment_author: update.author ?? AUTOMATION_AUTHOR,
    p_patch: update.patch ?? {},
    p_remove: [...(update.remove ?? [])],
  });
  if (error) throw error;
  const result = data as { inserted?: boolean; task?: Record<string, unknown> } | null;
  if (!result?.task) return null;
  return { inserted: Boolean(result.inserted), task: asTaskRecord(result.task) };
}

/** Substitui somente o último comentário automático de anexo do relatório.
 * A RPC remove esse comentário sob lock e preserva comentários humanos feitos
 * enquanto o PDF era renderizado; retries com o mesmo id são idempotentes. */
export async function replaceAutomaticReportAttachment(
  admin: AdminClient,
  taskId: string,
  input: { reportKind: "ads" | "conversion"; text: string; commentId: string; author?: string },
): Promise<PayloadUpdateResult | null> {
  const { data, error } = await admin.rpc("replace_automatic_report_attachment", {
    p_task_id: taskId,
    p_report_kind: input.reportKind,
    p_comment_id: input.commentId,
    p_comment_text: input.text,
    p_comment_author: input.author ?? AUTOMATION_AUTHOR,
  });
  if (error) throw error;
  const result = data as { inserted?: boolean; task?: Record<string, unknown> } | null;
  if (!result?.task) return null;
  return { inserted: Boolean(result.inserted), task: asTaskRecord(result.task) };
}

export type StatusTransition = {
  to: TaskStatus;
  /** Só move se o status ATUAL estiver aqui (compare-and-set). */
  from?: readonly TaskStatus[];
  /** Nunca move se o status atual estiver aqui. */
  unless?: readonly TaskStatus[];
  /** Só move se a tarefa ainda não foi concluída (`completed_at` nulo). */
  open?: boolean;
  /** Outras colunas escritas no MESMO UPDATE (ex.: `assignee`). Nada de `payload`. */
  extra?: Record<string, unknown>;
};

/**
 * Muda o status somente se a tarefa ainda está num estado de origem permitido.
 * Um filtro no próprio UPDATE — não uma leitura seguida de escrita —, então uma
 * execução atrasada que perdeu a corrida contra uma ação humana devolve `null`
 * em vez de rebaixar o card. Quem chama trata `null` como "alguém já avançou".
 */
export async function transitionTaskStatus(
  admin: AdminClient,
  taskId: string,
  transition: StatusTransition,
): Promise<TaskRecord | null> {
  let query = admin.from("tasks").update({ ...(transition.extra ?? {}), status: transition.to }).eq("id", taskId);
  if (transition.from?.length) query = query.in("status", [...transition.from]);
  if (transition.unless?.length) query = query.not("status", "in", `(${transition.unless.join(",")})`);
  if (transition.open) query = query.is("completed_at", null);
  const { data, error } = await query.select(TASK_COLUMNS).limit(1);
  if (error) throw error;
  return data?.[0] ? asTaskRecord(data[0]) : null;
}
