import { listApprovalQueue, listClients } from "@/lib/supabase";
import ApprovalsQueue from "./ApprovalsQueue";
import ScreenHeader from "../ScreenHeader";

export const dynamic = "force-dynamic";

export default async function AprovacoesPage() {
  const [approvals, clients] = await Promise.all([listApprovalQueue(), listClients()]);
  return (
    <section className="admin-page">
      <ScreenHeader title="Aprovações" lede="O que está com o cliente esperando aprovação." />
      <ApprovalsQueue
        initial={approvals}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
      />
    </section>
  );
}
