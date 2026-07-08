import { listActionPlans, listClients } from "@/lib/supabase";
import ActionPlansBoard from "./ActionPlansBoard";

export const dynamic = "force-dynamic";

export default async function PlanoPage() {
  const [plans, clients] = await Promise.all([listActionPlans(), listClients()]);
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Resultados</p>
          <h1 className="admin-title">Plano de Ação</h1>
          <p className="admin-sub">Cada plano agrupa as atividades vinculadas a ele. O progresso é a média das tarefas do plano.</p>
        </div>
      </header>
      <ActionPlansBoard initial={plans} clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />
    </section>
  );
}
