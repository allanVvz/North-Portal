import { listAdminOverview, listAllBriefings, listClients, listLeads } from "@/lib/supabase";
import { deriveClientsNeedingAttention } from "@/lib/adminHome";
import type { ClientRow } from "../ClientsTable";
import ClientesWorkspace from "./ClientesWorkspace";
import { clientStageFor } from "../clientPipeline";

export const dynamic = "force-dynamic";

// Duas telas: a lista de clientes e os Leads vindos dos formulários das landing
// pages. As rotinas que dividiam esta tela foram para /admin/operacao; o que
// ficou são as duas pontas da mesma relação — quem ainda é um formulário
// preenchido, e quem já é cliente.
//
// "Precisa de atenção" saiu da Home e virou parte do próprio card, em vez de um
// painel à parte: um segundo bloco listando os mesmos clientes por nome, na
// tela que já é a lista de clientes, seria a mesma informação duas vezes.
export default async function AdminClientsPage() {
  const [summaries, briefings, overview, leads] = await Promise.all([
    listClients({ includeDisabled: true }),
    listAllBriefings(),
    listAdminOverview(),
    listLeads(),
  ]);
  const checkpointsBySlug = new Map(briefings.map((b) => [b.slug, b.checkpointsPct]));
  const attentionBySlug = new Map(deriveClientsNeedingAttention(overview).map((c) => [c.slug, c.reasons]));
  const clients: ClientRow[] = summaries.map((c) => {
    const checkpointsPct = checkpointsBySlug.get(c.slug) ?? 0;
    return {
      ...c,
      checkpointsPct,
      stage: clientStageFor(c.briefing_submitted, checkpointsPct),
      attention: attentionBySlug.get(c.slug) ?? [],
    };
  });

  const needingAttention = clients.filter((c) => (c.attention ?? []).length > 0).length;
  const novosLeads = leads.filter((lead) => lead.status === "novo").length;

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">Clientes</h1>
          <p className="admin-sub">
            {clients.filter((c) => !c.disabled).length} clientes no sistema
            {needingAttention > 0 ? ` · ${needingAttention} precisam de atenção` : ""}
            {novosLeads > 0 ? ` · ${novosLeads} lead${novosLeads === 1 ? "" : "s"} sem triagem` : ""}.
          </p>
        </div>
      </header>
      <ClientesWorkspace clients={clients} leads={leads} />
    </section>
  );
}
