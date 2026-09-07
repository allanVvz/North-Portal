// Notificação a partir de quem roda com o service role.
//
// `lib/notifications.ts` importa `lib/supabase/server`, que importa
// `next/headers` — inutilizável fora de um request. As automações, a cascata de
// fluxo e o reconciliador já carregam um `AdminClient`, então chamam o RPC
// direto por ele.
//
// `p_actor` é quem provocou a ação, e o leque o exclui dos destinatários —
// ninguém precisa ser avisado do que acabou de fazer.
//
// Aqui ele era SEMPRE `null`, sob o argumento de que "o sistema fez isso, não
// há ninguém a excluir". Isso vale para o cron e para uma automação que roda
// sozinha. Mas a **cascata de fluxo** também passa por este módulo, e ali a
// ação teve dono: alguém concluiu uma etapa, e esse alguém recebia de volta o
// aviso de que a etapa seguinte havia nascido. Era metade da queixa de
// "notificações sem motivo aparente".
//
// Não dá para resolver no SQL (`p_actor default auth.uid()`): este caminho roda
// com o service role justamente para poder escrever em nome do cliente que
// aprovou no portal, e ali `auth.uid()` é nulo por construção. Por isso o ator
// chega como argumento, opcional — quem realmente é o sistema segue passando
// nada e continua idêntico.
//
// Best-effort, igual ao caminho do admin: uma notificação que falha não pode
// derrubar a automação que acabou de escrever no card.

import type { AdminClient } from "@/lib/automations/taskAccess";
import type { NotificationType } from "@/lib/notificationTypes";

export async function notifyFromAutomation(
  admin: AdminClient,
  taskId: string,
  type: NotificationType,
  message: string,
  actorId: string | null = null,
): Promise<void> {
  try {
    const { error } = await admin.rpc("notify_task_participants", {
      p_task_id: taskId,
      p_type: type,
      p_message: message,
      p_actor: actorId,
    });
    if (error) {
      console.error("Automation fan-out error", { code: error.code, message: error.message?.slice(0, 240) });
    }
  } catch (error) {
    console.error("Automation fan-out threw", error);
  }
}

/**
 * Avisa quem cuida de uma FRENTE, mesmo sem estar no card.
 *
 * O grid de Configurações › Equipe & papéis era cadastro decorativo: nada lia a
 * marcação. `gestor_trafego` é a primeira frente que decide alguma coisa — os
 * relatórios que as automações produzem interessam a quem gerencia tráfego,
 * ainda que o card seja de outra pessoa.
 *
 * Quem é gestor E participante do card não recebe duas linhas: a função no
 * banco desconta os participantes. Chamar DEPOIS do leque deixa isso óbvio na
 * leitura, embora a ordem não mude o resultado.
 */
export async function notifyResponsibilityHolders(
  admin: AdminClient,
  taskId: string,
  responsibility: "gestor_trafego",
  type: NotificationType,
  message: string,
  actorId: string | null = null,
): Promise<void> {
  try {
    const { error } = await admin.rpc("notify_responsibility_holders", {
      p_task_id: taskId,
      p_responsibility: responsibility,
      p_type: type,
      p_message: message,
      p_actor: actorId,
    });
    if (error) {
      console.error("Responsibility fan-out error", { code: error.code, message: error.message?.slice(0, 240) });
    }
  } catch (error) {
    console.error("Responsibility fan-out threw", error);
  }
}
