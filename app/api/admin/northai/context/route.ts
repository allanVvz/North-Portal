import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAdminClientDetail, getClient, listAutomationConfigs, listClients, listTasks } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, validateSlug } from "@/lib/validation";
import { clientInsight } from "@/lib/northai/gaps";
import { GED_AREAS, gedFolderPath } from "@/lib/ged/paths";
import { gedProviderName } from "@/lib/ged";
import { todayInTimezone } from "@/app/admin/recurringState";

// GET /api/admin/northai/context?slug= — o painel direito do Estúdio: quão
// amarrado o cliente está, os números do dia, o que falta e onde fica o GED.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const slug = validateSlug(new URL(request.url).searchParams.get("slug") ?? "");
    const client = await getClient(slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");

    const [tasks, detail, automations, clients] = await Promise.all([
      listTasks(client.id),
      getAdminClientDetail(slug),
      listAutomationConfigs(),
      listClients(),
    ]);
    const provider = gedProviderName();
    const contract = (detail?.contract ?? {}) as Record<string, unknown>;
    const hasContract = Object.values(contract).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));
    const today = todayInTimezone("America/Sao_Paulo");

    const insight = clientInsight({
      tasks,
      automations: automations.map((automation) => ({ automationKey: automation.automationKey, active: automation.active, targetTaskId: automation.targetTaskId })),
      hasContract,
      briefingSubmitted: Boolean(clients.find((entry) => entry.slug === slug)?.briefing_submitted),
      gedReady: provider === "storage" || Boolean(detail?.driveFolders.rootFolderId),
      today,
    });

    // Cards que podem receber uma automação: rotinas (moldes recorrentes) do cliente.
    const targets = tasks
      .filter((task) => task.recurrence_cadence && task.status !== "aprovado")
      .map((task) => ({ id: task.id, title: task.title }));
    const plans = tasks
      .filter((task) => task.kind === "plano_acao" && task.status !== "aprovado")
      .map((task) => ({ id: task.id, title: task.title }));
    const titles = Object.fromEntries(tasks.map((task) => [task.id, task.title]));

    return NextResponse.json({
      client: { slug: client.slug, name: client.name },
      today,
      insight: {
        ...insight,
        gaps: insight.gaps.map((gap) => ({ ...gap, tasks: (gap.taskIds ?? []).slice(0, 5).map((id) => ({ id, title: titles[id] ?? "" })) })),
      },
      ged: { provider, folders: GED_AREAS.map((area) => ({ key: area.key, path: gedFolderPath(client, area.key) })) },
      targets,
      plans,
    });
  } catch (error) {
    return apiError(error);
  }
}
