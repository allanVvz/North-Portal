// A rede de segurança — e a camada que realmente garante a corretude.
//
// Não existe um único ponto de escrita de status nesta base: o PATCH admin e a
// aprovação do cliente passam por updateTaskGroup, mas as automações escrevem
// direto com o client de serviço, e nada impede uma escrita futura por um
// caminho novo. Um gatilho síncrono plugado em N lugares está sempre a um
// caminho novo de distância de um buraco silencioso.
//
// Esta varredura fecha o buraco por construção: ela não pergunta "quem mudou o
// status", pergunta "existe etapa concluída sem sucessor?". Roda na cron
// diária que já existe (automations-run-daily). Os gatilhos síncronos servem
// só para o usuário ver a próxima etapa aparecer na hora, não para a correção.

import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { asTaskRecord, errorMessage } from "@/lib/automations/taskAccess";
import { advanceFlow, materializeFirstStep } from "./advance";

export type ReconcileSummary = { checked: number; created: number; errors: { taskId: string; message: string }[] };

// Esta varredura NÃO notifica, e é decisão, não esquecimento: ela pode tocar
// meses de histórico num tique só (BATCH abaixo), e avisar a partir daqui
// carpetearia a caixa de entrada com trabalho antigo. Quem notifica é
// `advanceFlow`, no momento em que a etapa nasce de verdade — e ele é chamado
// daqui também, então uma etapa criada pelo reconciliador avisa uma vez, pelo
// caminho certo.

/** How many completed steps one tick will look at. A cap keeps a backlog from
 * turning the daily cron into a long-running job; anything left over is picked
 * up by the next tick, since the query is driven by state, not by a queue. */
const BATCH = 200;

export async function reconcileFlows(): Promise<ReconcileSummary> {
  const admin = createAdminClient();
  const summary: ReconcileSummary = { checked: 0, created: 0, errors: [] };

  const { data, error } = await admin
    .from("tasks")
    .select(TASK_COLUMNS)
    .not("completed_at", "is", null)
    .not("subtype", "is", null)
    .order("completed_at", { ascending: false })
    .limit(BATCH);
  if (error) throw error;

  // Entregas VAZIAS. Toda ocorrência de uma entrega recorrente nasce assim, e
  // a varredura por etapa concluída abaixo nunca as alcança — sem etapa, não há
  // conclusão que a dispare. O gatilho síncrono no momento da criação é quem
  // resolve na hora; esta passagem é a rede, pelo mesmo princípio do arquivo:
  // perguntar pelo ESTADO ("existe entrega sem etapa?"), não por quem escreveu.
  const { data: vazias, error: vaziasError } = await admin
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("payload->>flow_parent", "true")
    .limit(BATCH);
  if (vaziasError) throw vaziasError;
  for (const row of vazias ?? []) {
    const entrega = asTaskRecord(row);
    try {
      const criada = await materializeFirstStep(admin, entrega);
      if (criada) summary.created += 1;
    } catch (error) {
      summary.errors.push({ taskId: entrega.id, message: errorMessage(error) });
    }
  }

  for (const row of data ?? []) {
    const step = asTaskRecord(row);
    summary.checked += 1;
    try {
      // advanceFlow é idempotente: um slot já ocupado não escreve nada.
      const outcome = await advanceFlow(admin, step);
      summary.created += outcome.created.length;
    } catch (advanceError) {
      // Per-step isolation: one broken template must not stop the sweep for
      // every other flow in the agency.
      summary.errors.push({ taskId: step.id, message: errorMessage(advanceError) });
    }
  }
  return summary;
}
