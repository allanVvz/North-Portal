import { listApprovalQueue, listClients } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import ApprovalsQueue from "./ApprovalsQueue";

export const dynamic = "force-dynamic";

export default async function AprovacoesPage() {
  const [approvals, clients, session] = await Promise.all([listApprovalQueue(), listClients(), getSession()]);
  const canApprove = session?.level === "gerente";
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Fila de aprovação</p>
          <h1 className="admin-title">Aprovações</h1>
        </div>
      </header>
      <ApprovalsQueue
        initial={approvals}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
        canApprove={canApprove}
      />
    </section>
  );
}
