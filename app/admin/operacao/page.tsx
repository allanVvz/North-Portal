import {
  listActionPlans,
  listAssigneeOptions,
  listClients,
  listRecurringTasks,
  recurringTasksStorageAvailable,
} from "@/lib/supabase";
import OperacaoWorkspace from "./OperacaoWorkspace";

export const dynamic = "force-dynamic";

// Tarefas, Rotinas e Plano de Ação são a mesma operação vista de três ângulos —
// ficam numa tela só, com a seleção na linha superior. A lista de clientes, que
// antes dividia esta tela com as rotinas, virou /admin/clientes.
export default async function OperacaoPage() {
  const [clients, plans, recurringTasks, assignees, recurringStorageAvailable] = await Promise.all([
    listClients(),
    listActionPlans(),
    listRecurringTasks(),
    listAssigneeOptions(),
    recurringTasksStorageAvailable(),
  ]);
  return (
    <OperacaoWorkspace
      clients={clients.map((c) => ({ slug: c.slug, name: c.name, disabled: c.disabled }))}
      plans={plans}
      recurringTasks={recurringTasks}
      assignees={assignees}
      recurringStorageAvailable={recurringStorageAvailable}
    />
  );
}
