import {
  listActionPlans,
  listAssigneeOptions,
  listFlowDeliveries,
  listClients,
  listRecurringTasks,
  recurringTasksStorageAvailable,
} from "@/lib/supabase";
import OperacaoWorkspace from "./OperacaoWorkspace";

export const dynamic = "force-dynamic";

// Tarefas, Entregas, Rotinas e Plano de Ação são a mesma operação vista de
// quatro ângulos —
// ficam numa tela só, com a seleção na linha superior. A lista de clientes, que
// antes dividia esta tela com as rotinas, virou /admin/clientes.
export default async function OperacaoPage() {
  const [clients, plans, deliveries, recurringTasks, assignees, recurringStorageAvailable] = await Promise.all([
    listClients(),
    listActionPlans(),
    listFlowDeliveries(),
    listRecurringTasks(),
    listAssigneeOptions(),
    recurringTasksStorageAvailable(),
  ]);
  return (
    <OperacaoWorkspace
      clients={clients.map((c) => ({ slug: c.slug, name: c.name, disabled: c.disabled }))}
      plans={plans}
      deliveries={deliveries}
      recurringTasks={recurringTasks}
      assignees={assignees}
      recurringStorageAvailable={recurringStorageAvailable}
    />
  );
}
