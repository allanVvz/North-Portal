import { listActionPlans } from "@/lib/supabase";
import ActionPlansBoard from "./ActionPlansBoard";

export const dynamic = "force-dynamic";

export default async function PlanoPage() {
  const plans = await listActionPlans();
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Operação</p>
          <h1 className="admin-title">Plano de Ação</h1>
          <p className="admin-sub">Cada plano agrupa as atividades vinculadas a ele. O progresso é a média das tarefas do plano.</p>
        </div>
      </header>
      <ActionPlansBoard initial={plans} />
    </section>
  );
}
