import { redirect } from "next/navigation";
import { getAdminTabsVisibility, getMyProfile, getProfileName, listTeam } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import { initialsOf } from "../avatar/initials";
import { photoKey } from "../avatar/photoKey";
import type { TeamPhotoIndex } from "./CurrentUserContext";
import AdminShell from "./AdminShell";

// Admin shell: gated by role (defense in depth alongside middleware).
// The interactive chrome (theme toggle + account panel) lives in AdminShell.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");

  const email = session.email ?? "";
  // A foto do usuário logado e o índice de fotos da equipe são carregados aqui,
  // uma vez por navegação do admin, e distribuídos por contexto — a barra
  // lateral usa a primeira, os comentários de tarefa usam o índice.
  // Ver app/avatar/README.md.
  const [profileName, tabsVisibility, myProfile, team] = await Promise.all([
    getProfileName(session.userId),
    getAdminTabsVisibility(),
    getMyProfile(session.userId),
    listTeam(),
  ]);
  const name = profileName ?? "Administrador";
  const initials = profileName ? initialsOf(profileName) : (email.split("@")[0] || "AD").slice(0, 2).toUpperCase();

  const teamPhotos: TeamPhotoIndex = {};
  for (const member of team) {
    if (member.full_name && member.avatar_url) teamPhotos[photoKey(member.full_name)] = member.avatar_url;
  }

  return (
    <AdminShell
      email={email}
      name={name}
      initials={initials}
      userId={session.userId}
      avatarUrl={myProfile.avatar_url}
      teamPhotos={teamPhotos}
      revisoesTabVisible={tabsVisibility.revisoesTabVisible}
      aprovacoesTabVisible={tabsVisibility.aprovacoesTabVisible}
    >
      {children}
    </AdminShell>
  );
}
