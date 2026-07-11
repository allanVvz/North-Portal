import { listAllBriefings, listClients, listDocuments } from "@/lib/supabase";
import DocumentsTable from "./DocumentsTable";
import OnboardingTable from "../onboarding/OnboardingTable";

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  const [documents, clients, briefings] = await Promise.all([
    listDocuments(),
    listClients(),
    listAllBriefings(),
  ]);
  const manualPending = briefings.filter((r) => !r.manualSeen).length;
  const briefPending = briefings.filter((r) => !r.submitted).length;
  const notDone = briefings.filter((r) => r.checkpointsPct < 100).length;

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Dados</p>
          <h1 className="admin-title">Informações</h1>
        </div>
      </header>

      <div className="info-section">
        <div className="info-section-head">
          <h2>Documentos</h2>
          <p className="admin-sub">Contratos, propostas, relatórios e materiais — visíveis ao cliente no portal.</p>
        </div>
        <DocumentsTable initial={documents} clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />
      </div>

      <div className="info-divider" role="separator" aria-hidden />

      <div className="info-section-centered">
        <div className="info-panel">
          <div className="info-section-head">
            <p className="info-eyebrow">Onboarding</p>
            <h2>Briefing</h2>
            <p className="admin-sub">
              Manual do Cliente: {manualPending} pendente{manualPending === 1 ? "" : "s"} · Briefing: {briefPending} pendente{briefPending === 1 ? "" : "s"} · Checkpoints comerciais: {notDone} cliente{notDone === 1 ? "" : "s"} em andamento
            </p>
          </div>
          <OnboardingTable rows={briefings} />
        </div>
      </div>
    </section>
  );
}
