// "A automação não rodou" — o único modo de falha que o pipeline não contava.
//
// `errorHandling.markTaskParada` cobre "rodei e quebrei": toda exceção vira
// comentário no card. Mas o gate de elegibilidade (`run.ts`, `target.due_date
// !== today`) é uma igualdade ESTRITA, e um ciclo que não roda no dia exato do
// vencimento nunca mais coincide com `today`: o molde fica parado naquela data,
// `runOneReportAutomation` devolve `not_due` todo dia, `automation_runs` grava
// `succeeded` (não houve erro) e ninguém fica sabendo. Foi assim que a cascata
// de segunda parou sem deixar rastro.
//
// A decisão foi manter o gate estrito — nada roda fora do dia certo, para nunca
// publicar um relatório de período errado — e pagar por isso com um alerta. A
// saúde da automação é o comentário no próprio card (não há tela de saúde): uma
// vez por vencimento perdido, com o motivo e o que fazer.

import { recurrenceCycleOf, recurrenceStopped } from "@/lib/recurrenceState";
import { recurringExecutionId } from "@/lib/recurrence";
import { agencyToday } from "@/lib/time/agency";
import { notifyFromAutomation } from "./notify";
import { getAdminTask, type AdminClient } from "./taskAccess";
import { automationCommentId, updateTaskPayload } from "./taskWrites";
import type { TaskRecord } from "@/lib/validation";

/** SÓ a automação de anúncios. É a única cujo disparo depende de `due_date =
 *  hoje` — `relatorio_conversao` não olha vencimento nenhum: varre as
 *  ocorrências abertas todo dia (`conversionFlow.runConversionFlow`), então o
 *  molde da Entrega fica legitimamente vencido enquanto o ciclo está em
 *  andamento e vigiá-lo só produziria alarme falso. `provisionar_card_metricas`
 *  é fan-out síncrono e `coleta_metrica_cliente` é stub. */
const WATCHED_KEY = "relatorio_trafego_semanal";

type WatchedConfig = { id: string; target_task_id: string };

export function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/** Um comentário por vencimento perdido, venha ele do pulo do próprio tique
 *  (`run.ts`, que sabe na hora por que não gerou) ou deste detector no dia
 *  seguinte. Compartilhar o id faz o segundo a chegar ser um no-op, em vez de
 *  dois comentários sobre o mesmo ciclo. */
export function missedCycleCommentId(configId: string, dueDate: string): string {
  return automationCommentId("automation-missed", configId, dueDate);
}

/** O molde da Entrega, quando esta automação de anúncios é a primeira etapa de
 *  um fluxo de conversão. A dependência é declarada, nunca deduzida — a mesma
 *  leitura que `run.ts` faz em `dependentConversionConfig`. */
async function flowDeliveryMold(admin: AdminClient, config: WatchedConfig): Promise<TaskRecord | null> {
  const { data, error } = await admin
    .from("automation_configs")
    .select("target_task_id")
    .eq("depends_on_config_id", config.id)
    .eq("automation_key", "relatorio_conversao")
    .eq("active", true)
    .limit(1);
  if (error) throw error;
  const targetId = (data?.[0] as { target_task_id?: string } | undefined)?.target_task_id;
  return targetId ? await getAdminTask(admin, targetId) : null;
}

/** Por que o vencimento passou sem gerar nada. Duas causas com tratamentos
 *  diferentes, e confundi-las era metade do problema: "a Entrega anterior está
 *  aberta" é o fluxo funcionando como projetado (a próxima só nasce quando a
 *  anterior é concluída — tráfego E conversão), enquanto "não há ocorrência" é
 *  uma execução que morreu antes de criar qualquer coisa. */
async function missedReason(admin: AdminClient, config: WatchedConfig, mold: TaskRecord, dueDate: string): Promise<string> {
  // De QUAL molde pende a ocorrência depende do modo. Em modo-fluxo (há uma
  // `relatorio_conversao` declarando depender desta automação) quem hospeda a
  // ocorrência é o molde da ENTREGA, não este; em modo normal
  // (`materializeOccurrenceForReport`) é este mesmo. Procurar sempre neste molde
  // dava "não há ocorrência" justamente no caso da cascata, que é o que
  // interessa.
  const host = (await flowDeliveryMold(admin, config)) ?? mold;
  // `ensureFlowOccurrence` cria a ocorrência no ciclo SEGUINTE ao do molde
  // hospedeiro, e o avanço do hospedeiro só acontece quando o ciclo fecha. Um
  // vencimento perdido com a ocorrência já criada é um ciclo que começou e não
  // terminou.
  const occurrence = await getAdminTask(admin, recurringExecutionId(host.id, recurrenceCycleOf(host) + 1));
  const venceu = shortDate(dueDate);

  if (occurrence && !occurrence.completed_at) {
    return `Esta automação não rodou: o vencimento de ${venceu} passou e a Entrega "${occurrence.title}" continua aberta.`
      + ` A próxima Entrega só é gerada quando a anterior é concluída — relatório de tráfego e relatório de conversão.`
      + ` Conclua a Entrega em aberto; se o ciclo de ${venceu} for para ser abandonado, mova o vencimento deste card para a próxima data.`;
  }

  return `Esta automação não rodou: o vencimento de ${venceu} passou sem gerar a Entrega da semana.`
    + ` A automação só dispara no dia exato do vencimento, e enquanto este card continuar vencido em ${venceu} ela não tentará de novo.`
    + ` Ajuste o vencimento para a próxima data para voltar ao ciclo.`;
}

/**
 * Comenta, uma vez por vencimento perdido, em todo molde de automação cujo
 * `due_date` já passou sem ter avançado. Idempotente pelo id do comentário
 * (`automation-missed:<config>:<vencimento>`), então rodar todo dia sobre o
 * mesmo molde vencido não empilha comentário nem notificação.
 *
 * Nunca lança para quem chama tratar: é um detector, não pode derrubar o tique
 * que acabou de executar as automações de verdade.
 */
export async function reportMissedAutomationCycles(admin: AdminClient, today = agencyToday()): Promise<number> {
  const { data, error } = await admin
    .from("automation_configs")
    .select("id,target_task_id")
    .eq("automation_key", WATCHED_KEY)
    .eq("active", true);
  if (error) throw error;

  let commented = 0;
  for (const config of (data ?? []) as WatchedConfig[]) {
    const mold = await getAdminTask(admin, config.target_task_id);
    // Sem recorrência não há ciclo a perder: um card comum é preenchido no
    // lugar e o vencimento dele é assunto de quem o criou.
    if (!mold?.due_date || !mold.recurrence_cadence) continue;
    if (mold.due_date >= today) continue;
    // Recorrência encerrada de propósito (molde aprovado ou parado) — a mesma
    // regra que `run.ts` usa para não gerar mais nada. Avisar aqui seria ruído.
    if (recurrenceStopped(mold.status)) continue;

    const result = await updateTaskPayload(admin, mold.id, {
      text: await missedReason(admin, config, mold, mold.due_date),
      commentId: missedCycleCommentId(config.id, mold.due_date),
    });
    if (!result?.inserted) continue; // este vencimento já foi comentado

    commented += 1;
    await notifyFromAutomation(
      admin,
      mold.id,
      "task_commented",
      `"${mold.title}" não rodou no vencimento de ${shortDate(mold.due_date)}.`,
    );
  }
  return commented;
}
