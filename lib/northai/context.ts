// Caso de uso: o contexto de um cliente no Estúdio — quem é, o que o NorthAi
// sabe (cadastro conectado), a operação hoje, o que falta amarrar, onde ficam
// os arquivos e as opções que as receitas oferecem (planos e rotinas existentes).
//
// Uma função só monta tudo; as rotas não reconstroem cliente, datas, planos e
// automações cada uma do seu jeito.

import { getAdminClientDetail, getClient, listAutomationConfigs, listClientTasksAll, listClients } from "@/lib/supabase";
import { isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import { GED_AREAS } from "@/lib/ged/paths";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { agencyToday } from "@/lib/time/agency";
import { clientInsight, type Gap, type OperationToday, type ReadinessCheck } from "./gaps";

export type NorthAiGap = Omit<Gap, "taskIds"> & { tasks: { id: string; title: string }[] };

export type NorthAiClientContext = {
  identity: { slug: string; name: string };
  today: string;
  knowledge: { percent: number; checks: ReadinessCheck[] };
  operation: OperationToday;
  gaps: NorthAiGap[];
  files: { location: "drive" | "interno"; areas: { key: string; label: string }[] };
  options: { plans: { id: string; title: string }[]; routines: { id: string; title: string }[] };
};

export async function getNorthAiClientContext(slug: string): Promise<NorthAiClientContext | null> {
  const client = await getClient(slug, true);
  if (!client) return null;

  // Leituras em paralelo; qualquer falha lança (HttpError 503) — a tela mostra
  // erro de carregamento em vez de lacunas que não existem.
  const [tasks, detail, automations, clients] = await Promise.all([
    listClientTasksAll(client.id),
    getAdminClientDetail(slug),
    listAutomationConfigs(),
    listClients(),
  ]);

  const contract = (detail?.contract ?? {}) as Record<string, unknown>;
  const hasContract = Object.values(contract).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));
  const driveConfigured = isGoogleDriveConfigured();
  const today = agencyToday();

  const insight = clientInsight({
    tasks,
    automations: automations.map((automation) => ({ automationKey: automation.automationKey, active: automation.active, targetTaskId: automation.targetTaskId })),
    hasContract,
    briefingSubmitted: Boolean(clients.find((entry) => entry.slug === slug)?.briefing_submitted),
    filesReady: !driveConfigured || Boolean(detail?.driveFolders.rootFolderId),
    today,
  });

  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  return {
    identity: { slug: client.slug, name: client.name },
    today,
    knowledge: insight.readiness,
    operation: insight.operation,
    gaps: insight.gaps.map(({ taskIds, ...gap }) => ({ ...gap, tasks: (taskIds ?? []).slice(0, 5).map((id) => ({ id, title: titles.get(id) ?? "" })) })),
    files: { location: driveConfigured ? "drive" : "interno", areas: GED_AREAS.map((area) => ({ key: area.key, label: area.label })) },
    options: {
      plans: tasks.filter((task) => task.kind === "plano_acao" && task.status !== "aprovado").map((task) => ({ id: task.id, title: task.title })),
      // Rotinas que podem receber uma automação: moldes recorrentes em andamento.
      routines: tasks.filter((task) => task.recurrence_cadence && !recurrenceStopped(task.status)).map((task) => ({ id: task.id, title: task.title })),
    },
  };
}
