import { listAllBriefings, listClients, listDocuments } from "@/lib/supabase";
import InformacoesWorkspace from "./InformacoesWorkspace";

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  const [documents, clients, briefings] = await Promise.all([
    listDocuments(),
    listClients(),
    listAllBriefings(),
  ]);

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Dados</p>
          <h1 className="admin-title">Informações</h1>
        </div>
      </header>

      <InformacoesWorkspace
        documents={documents}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
        briefings={briefings}
      />
    </section>
  );
}
