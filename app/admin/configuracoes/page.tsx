import { getAgencyProfile, listCheckpointTemplates, listClients, listLegalDocs, listTeam } from "@/lib/supabase";
import SettingsPanel from "./SettingsPanel";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const [legalDocs, agency, team, checkpointTemplates, clients] = await Promise.all([
    listLegalDocs(),
    getAgencyProfile(),
    listTeam(),
    listCheckpointTemplates(),
    listClients(),
  ]);
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">Configurações</h1>
        </div>
      </header>
      <SettingsPanel
        legalDocs={legalDocs}
        agency={agency}
        team={team}
        checkpointTemplates={checkpointTemplates}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
      />
    </section>
  );
}
