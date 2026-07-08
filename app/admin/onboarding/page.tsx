import { listAllBriefings } from "@/lib/supabase";
import OnboardingTable from "./OnboardingTable";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const rows = await listAllBriefings();
  const manualPending = rows.filter((r) => !r.manualSeen).length;
  const pending = rows.filter((r) => !r.submitted).length;
  const notDone = rows.filter((r) => r.checkpointsPct < 100).length;
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Conteúdo</p>
          <h1 className="admin-title">Onboarding</h1>
          <p className="admin-sub">
            Manual do Cliente: {manualPending} pendente{manualPending === 1 ? "" : "s"} · Briefing: {pending} pendente{pending === 1 ? "" : "s"} · Checkpoints comerciais: {notDone} cliente{notDone === 1 ? "" : "s"} em andamento
          </p>
        </div>
      </header>
      <OnboardingTable rows={rows} />
    </section>
  );
}
