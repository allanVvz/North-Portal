// Aviso ANTES da segunda quando a credencial da Meta está quebrada.
//
// Em 21/09/2026 o relatório de três clientes não saiu porque a conta do Facebook
// que autorizou o North App estava num checkpoint de segurança. Só se descobriu
// depois, pelo card `parada` — na segunda de manhã, com o cliente esperando.
// O bloqueio existia antes disso: uma única chamada à Graph API em qualquer dia
// da semana anterior teria devolvido o mesmo erro.
//
// A decisão foi não trocar o tipo de token agora (um System User token do
// Business Manager não é checkpointed nem expira, e resolveria a classe toda —
// ficou como frente própria), e sim descobrir o problema com antecedência.
//
// Duas escolhas que evitam ruído:
//   - só avisa quando um relatório está REALMENTE a caminho (vencimento dentro
//     de 2 dias, a mesma janela de `routineReminders`), não todo dia;
//   - só avisa sobre cliente que depende da Meta. Quem tem conta Windsor
//     mapeada não é afetado por uma credencial Meta quebrada.

import { addDaysIso, agencyToday } from "@/lib/time/agency";
import { graphGet } from "@/lib/meta";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { notifyFromAutomation } from "./notify";
import { errorMessage, getAdminTask, type AdminClient } from "./taskAccess";
import { automationCommentId, updateTaskPayload } from "./taskWrites";
import { adsAccountFor, getClientById, getMetaSettingsService, getWindsorSettingsService } from "./serviceIntegrations";
import { shortDate } from "./moldHealth";

/** Mesma janela de `routineReminders`: avisar com dois dias de folga. */
const WINDOW_DAYS = 2;

type AdsConfig = { id: string; target_task_id: string };

export async function warnBeforeMetaCredentialFailure(admin: AdminClient, today = agencyToday()): Promise<number> {
  const { data, error } = await admin
    .from("automation_configs")
    .select("id,target_task_id")
    .eq("automation_key", "relatorio_trafego_semanal")
    .eq("active", true);
  if (error) throw error;

  // Quem está a caminho de vencer. Sem ninguém na janela, nem vale gastar uma
  // chamada na Meta.
  const limit = addDaysIso(today, WINDOW_DAYS);
  const pending: { config: AdsConfig; moldId: string; dueDate: string; title: string; clientId: string }[] = [];
  for (const config of (data ?? []) as AdsConfig[]) {
    const mold = await getAdminTask(admin, config.target_task_id);
    if (!mold?.due_date || !mold.client_id) continue;
    if (mold.due_date < today || mold.due_date > limit) continue;
    if (recurrenceStopped(mold.status)) continue;
    pending.push({ config, moldId: mold.id, dueDate: mold.due_date, title: mold.title, clientId: mold.client_id });
  }
  if (!pending.length) return 0;

  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
  if (!meta.accessToken) return 0; // sem Meta configurada não há credencial a vigiar

  // Uma chamada só, a mais barata que existe. Um checkpoint na conta derruba
  // qualquer endpoint, então `/me` é diagnóstico suficiente — e não gasta cota
  // de insights.
  let failure: string | null = null;
  try {
    await graphGet("/me", { fields: "id", access_token: meta.accessToken });
  } catch (probeError) {
    failure = errorMessage(probeError);
  }
  if (!failure) return 0;

  let warned = 0;
  for (const item of pending) {
    // Cliente que puxa dados pelo Windsor não depende deste token.
    const client = await getClientById(item.clientId);
    if (!client) continue;
    const account = adsAccountFor(client.slug, windsor, meta);
    if (!account?.metaAccountId) continue;

    const result = await updateTaskPayload(admin, item.moldId, {
      text: `Atenção: o relatório de ${shortDate(item.dueDate)} corre risco de não ser gerado. A integração com a Meta está respondendo erro agora: ${failure}`,
      commentId: automationCommentId("meta-credential", item.config.id, item.dueDate),
    });
    if (!result?.inserted) continue; // já avisado para este vencimento

    warned += 1;
    await notifyFromAutomation(
      admin,
      item.moldId,
      "task_commented",
      `Integração com a Meta com erro: "${item.title}" vence em ${shortDate(item.dueDate)}.`,
    );
  }
  return warned;
}
