import { listAllBriefings, listClients, listDocuments, listNorthTrilhas } from "@/lib/supabase";
import { clientStageFor } from "../clientPipeline";
import type { ClientRow } from "../ClientsTable";
import InformacoesWorkspace from "./InformacoesWorkspace";

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  const [documents, clientSummaries, briefings, trilhas] = await Promise.all([
    listDocuments(),
    listClients({ includeDisabled: true }),
    listAllBriefings(),
    listNorthTrilhas().catch(() => []),
  ]);

  const checkpointsBySlug = new Map(briefings.map((b) => [b.slug, b.checkpointsPct]));
  const clientRows: ClientRow[] = clientSummaries.map((c) => {
    const checkpointsPct = checkpointsBySlug.get(c.slug) ?? 0;
    return { ...c, checkpointsPct, stage: clientStageFor(c.briefing_submitted, checkpointsPct) };
  });

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
        trilhas={trilhas}
        clients={clientSummaries.map((c) => ({ slug: c.slug, name: c.name }))}
        briefings={briefings}
        clientRows={clientRows}
      />
    </section>
  );
}
