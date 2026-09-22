// "E agora, o quê?" — a frase que faltava nos comentários da automação.
//
// Anúncios e conversão já anunciam o que FIZERAM ("relatório gerado e anexado") e
// deixam a etapa em `revisao`. Nenhum dos dois diz o que se espera de quem lê, nem
// o que acontece depois de aprovar. Quem abre o card sabe que há um PDF novo e não
// sabe se a bola está com ele.
//
// A frase é derivada do workflow versionado da própria ocorrência — nunca de uma
// lista fixa aqui. Se alguém reordenar as etapas na tela de Etapas, o aviso
// acompanha. Quando não há próxima etapa, o recado é que aprovar CONCLUI a Entrega.

import { nextWorkflowStep, workflowByVersionId, workflowStepByKey } from "@/lib/workflows";
import type { AdminClient } from "./taskAccess";

/**
 * Uma frase sobre o que vem depois desta etapa, ou `null` quando não há workflow
 * para consultar (o aviso simplesmente não entra, em vez de chutar).
 *
 * Nunca lança: é texto de cortesia num comentário, não pode derrubar uma geração
 * de relatório que já deu certo.
 */
export async function nextStepNotice(
  admin: AdminClient,
  occurrence: { workflow_version_id?: string | null },
  currentStepKey: string,
): Promise<string | null> {
  try {
    if (!occurrence.workflow_version_id) return null;
    const workflow = await workflowByVersionId(admin, occurrence.workflow_version_id);
    if (!workflow) return null;
    const current = workflowStepByKey(workflow, currentStepKey);
    if (!current?.workflow_step_id) return null;
    const next = nextWorkflowStep(workflow, current.workflow_step_id);
    return next
      ? `Ao aprovar esta etapa, a próxima é "${next.label}".`
      : "Esta é a última etapa: aprovar conclui a Entrega.";
  } catch (error) {
    console.error("nextStepNotice failed", error);
    return null;
  }
}

/** Junta o corpo do comentário ao aviso, sem deixar linha em branco sobrando
 *  quando o aviso não pôde ser derivado. */
export function withNextStepNotice(body: string, notice: string | null): string {
  return notice ? `${body}\n\n${notice}` : body;
}
