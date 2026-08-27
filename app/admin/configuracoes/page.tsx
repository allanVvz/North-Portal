import { getAgencyProfile, getMyProfile, getProfileName, listCheckpointTemplates, listClients, listLegalDocs, listResponsibilityAssignments, listTeam } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import SettingsPanel from "./SettingsPanel";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");

  const [legalDocs, agency, team, checkpointTemplates, clients, profileName, myProfile, responsibilities] = await Promise.all([
    listLegalDocs(),
    getAgencyProfile(),
    listTeam(),
    listCheckpointTemplates(),
    listClients(),
    getProfileName(session.userId),
    getMyProfile(session.userId),
    listResponsibilityAssignments(),
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
        currentUser={{ fullName: profileName ?? "", email: session.email ?? "", bio: myProfile.bio, avatarUrl: myProfile.avatar_url }}
        responsibilities={responsibilities}
      />
    </section>
  );
}
