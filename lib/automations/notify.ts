// Notificação a partir de quem roda com o service role.
//
// `lib/notifications.ts` importa `lib/supabase/server`, que importa
// `next/headers` — inutilizável fora de um request. As automações, a cascata de
// fluxo e o reconciliador já carregam um `AdminClient`, então chamam o RPC
// direto por ele.
//
// `p_actor: null` é explícito e significa "o sistema fez isso". O leque exclui
// o autor da ação da lista de destinatários; quando não houve pessoa alguma,
// não há ninguém a excluir, e todos os envolvidos são avisados — que é o
// comportamento certo, não um descuido.
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
): Promise<void> {
  try {
    const { error } = await admin.rpc("notify_task_participants", {
      p_task_id: taskId,
      p_type: type,
      p_message: message,
      p_actor: null,
    });
    if (error) {
      console.error("Automation fan-out error", { code: error.code, message: error.message?.slice(0, 240) });
    }
  } catch (error) {
    console.error("Automation fan-out threw", error);
  }
}
