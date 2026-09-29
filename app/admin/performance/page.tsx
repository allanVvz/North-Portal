import { listClients, listPublishedTasks } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import PerformanceScreen from "./PerformanceScreen";
import ScreenHeader from "../ScreenHeader";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const [tasks, clients, session] = await Promise.all([listPublishedTasks(), listClients(), getSession()]);
  const canEdit = session?.level === "gerente";
  return (
    <section className="admin-page kb-wide performance-page">
      <ScreenHeader title="Performance" lede="Mídia paga e resultados por cliente, semana a semana: investimento, alcance e o que ele trouxe." />
      <PerformanceScreen
        initialTasks={tasks}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
        canEdit={canEdit}
      />
    </section>
  );
}
