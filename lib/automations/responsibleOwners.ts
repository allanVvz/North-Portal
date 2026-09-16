// Quem é responsável por um card que uma automação cria (ATA 14/09).
//
// As etapas do fluxo de relatório nasciam com o responsável "North ai" — o
// autor da automação, não uma pessoa. Resultado: o card não aparecia na Home de
// ninguém, e quem executa (a Luiza, que cuida do tráfego) só sabia dele pelo
// sino. Agora a etapa nasce com quem está marcado na frente em Configurações ›
// Equipe & papéis (`gestor_trafego`): o card entra na Home dessas pessoas, na
// coluna delas no quadro, e o atraso passa a ser delas.
//
// Sem ninguém marcado na frente, devolve null e o chamador mantém o
// responsável de automação — o card continua existindo, só sem dono.

import { formatAssignees } from "@/lib/assignees";
import type { ResponsibilityKey } from "@/lib/validation";
import type { AdminClient } from "./taskAccess";

export async function assignResponsibilityHolders(
  admin: AdminClient,
  taskId: string,
  responsibility: ResponsibilityKey,
): Promise<string | null> {
  try {
    const { data: links, error: linksError } = await admin
      .from("responsibility_assignments")
      .select("profile_id")
      .eq("responsibility", responsibility);
    if (linksError || !links?.length) return null;
    const ids = [...new Set(links.map((row) => (row as { profile_id: string }).profile_id))];
    const { data: profiles, error: profilesError } = await admin.from("profiles").select("id,full_name").in("id", ids);
    if (profilesError) return null;
    const holders = ((profiles ?? []) as { id: string; full_name: string | null }[])
      .filter((profile) => profile.full_name?.trim())
      .sort((a, b) => (a.full_name as string).localeCompare(b.full_name as string, "pt-BR"));
    if (!holders.length) return null;

    const { error: deleteError } = await admin.from("task_assignees").delete().eq("task_id", taskId);
    if (deleteError) return null;
    const { error: insertError } = await admin
      .from("task_assignees")
      .insert(holders.map((holder) => ({ task_id: taskId, profile_id: holder.id })));
    if (insertError) return null;
    return formatAssignees(holders.map((holder) => (holder.full_name as string).trim()));
  } catch {
    return null;
  }
}
