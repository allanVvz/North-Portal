import {
  listAllBriefings,
  listAssigneeOptions,
  listClients,
  listRecurringTasks,
  recurringTasksStorageAvailable,
} from "@/lib/supabase";
import ClientsWorkspace from "./ClientsWorkspace";
import type { ClientRow } from "./ClientsTable";
import { clientStageFor } from "./clientPipeline";

export const dynamic = "force-dynamic";

export default async function AdminClientsPage() {
  const [summaries, briefings, recurringTasks, assignees, recurringStorageAvailable] = await Promise.all([
    listClients({ includeDisabled: true }),
    listAllBriefings(),
    listRecurringTasks(),
    listAssigneeOptions(),
    recurringTasksStorageAvailable(),
  ]);
  const checkpointsBySlug = new Map(briefings.map((b) => [b.slug, b.checkpointsPct]));
  const clients: ClientRow[] = summaries.map((c) => {
    const checkpointsPct = checkpointsBySlug.get(c.slug) ?? 0;
    return { ...c, checkpointsPct, stage: clientStageFor(c.briefing_submitted, checkpointsPct) };
  });
  return <ClientsWorkspace
    clients={clients}
    recurringTasks={recurringTasks}
    assignees={assignees}
    recurringStorageAvailable={recurringStorageAvailable}
  />;
}
