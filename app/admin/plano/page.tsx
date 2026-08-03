import { listActionPlans, listAssigneeOptions, listClients } from "@/lib/supabase";
import ActionPlansBoard from "./ActionPlansBoard";

export const dynamic = "force-dynamic";

export default async function PlanoPage() {
  const [plans, clients, assignees] = await Promise.all([listActionPlans(), listClients(), listAssigneeOptions()]);
  return (
    <section className="admin-page">
      <ActionPlansBoard initial={plans} clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} assignees={assignees} />
    </section>
  );
}
