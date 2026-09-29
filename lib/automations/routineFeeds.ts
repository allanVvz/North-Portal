// Uma automação de relatório semanal tem DOIS moldes recorrentes: o do
// Relatório de anúncios (onde o cron gera o PDF) e o da Entrega "Relatórios ·
// Automação" (as três etapas da semana). Para a pessoa é UMA rotina. Na
// Operação ela aparecia duas vezes, e a da Entrega ainda saía "Atrasada": o
// vencimento desse molde não é empurrado (quem decide o dia é a regra de
// recorrência, lib/automations/run.ts), então ficava parado na primeira data.
//
// Aqui o molde de anúncios é marcado como representado pelo da Entrega, que é
// o trabalho que a equipe acompanha, e o da Entrega passa a mostrar a próxima
// data real, a do molde de anúncios, que o cron avança a cada geração.

import { createAdminClient } from "@/lib/supabase/admin";
import type { RecurringTask } from "@/lib/supabase";

export type RoutineWithFeed = RecurringTask & {
  /** Rotina que representa esta na Operação (o molde da Entrega). */
  represented_by?: string | null;
};

type ConfigRow = { id: string; automation_key: string; target_task_id: string; depends_on_config_id: string | null };

/** Molde de anúncios → molde da Entrega, a partir das automações ativas. */
export function feedsOf(configs: readonly ConfigRow[]): Map<string, string> {
  const byId = new Map(configs.map((config) => [config.id, config]));
  const feeds = new Map<string, string>();
  for (const config of configs) {
    if (config.automation_key !== "relatorio_conversao" || !config.depends_on_config_id) continue;
    const ads = byId.get(config.depends_on_config_id);
    if (ads && ads.target_task_id !== config.target_task_id) feeds.set(ads.target_task_id, config.target_task_id);
  }
  return feeds;
}

export function foldFeeds(routines: readonly RecurringTask[], feeds: ReadonlyMap<string, string>): RoutineWithFeed[] {
  const byId = new Map(routines.map((routine) => [routine.id, routine]));
  const feederOf = new Map([...feeds].map(([ads, delivery]) => [delivery, ads]));
  return routines.map((routine): RoutineWithFeed => {
    const target = feeds.get(routine.id);
    if (target && byId.has(target)) return { ...routine, represented_by: target };
    const ads = byId.get(feederOf.get(routine.id) ?? "");
    return ads?.next_due_date ? { ...routine, next_due_date: ads.next_due_date } : routine;
  });
}

/** Falha ao ler as automações não pode tirar as rotinas da tela: devolve como veio. */
export async function withAutomationFeeds(routines: RecurringTask[]): Promise<RoutineWithFeed[]> {
  try {
    const { data, error } = await createAdminClient()
      .from("automation_configs")
      .select("id,automation_key,target_task_id,depends_on_config_id")
      .eq("active", true)
      .in("automation_key", ["relatorio_trafego_semanal", "relatorio_conversao"]);
    if (error) throw error;
    return foldFeeds(routines, feedsOf((data ?? []) as ConfigRow[]));
  } catch {
    return routines;
  }
}
