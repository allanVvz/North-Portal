import { listAdminOverview, listAllBriefings, listClients } from "@/lib/supabase";
import { deriveClientsNeedingAttention } from "@/lib/adminHome";
import ClientsTable, { type ClientRow } from "../ClientsTable";
import { clientStageFor } from "../clientPipeline";

export const dynamic = "force-dynamic";

// A lista de clientes, sozinha. As rotinas que dividiam esta tela foram para
// /admin/operacao; aqui a única pergunta é "em qual cliente eu quero entrar",
// e a resposta é o card de Visualizar.
//
// "Precisa de atenção" saiu da Home e virou parte do próprio card, em vez de um
// painel à parte: um segundo bloco listando os mesmos clientes por nome, na
// tela que já é a lista de clientes, seria a mesma informação duas vezes.
export default async function AdminClientsPage() {
  const [summaries, briefings, overview] = await Promise.all([
    listClients({ includeDisabled: true }),
    listAllBriefings(),
    listAdminOverview(),
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

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">Clientes</h1>
          <p className="admin-sub">
            {clients.filter((c) => !c.disabled).length} clientes no sistema
            {needingAttention > 0 ? ` · ${needingAttention} precisam de atenção` : ""}.
          </p>
        </div>
      </header>
      {clients.length ? <ClientsTable clients={clients} /> : <p className="admin-empty">Nenhum cliente ainda. Crie o primeiro.</p>}
    </section>
  );
}
