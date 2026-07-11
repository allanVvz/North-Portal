import { listClients, listPublishedTasks } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import PerformanceScreen from "./PerformanceScreen";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const [tasks, clients, session] = await Promise.all([listPublishedTasks(), listClients(), getSession()]);
  const canEdit = session?.level === "gerente";
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Dados</p>
          <h1 className="admin-title">Performance</h1>
        </div>
      </header>
      <PerformanceScreen
        initialTasks={tasks}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
        canEdit={canEdit}
      />
    </section>
  );
}
