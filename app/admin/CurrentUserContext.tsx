"use client";

import { createContext, useContext } from "react";

import { photoKey } from "../avatar/photoKey";

export type CurrentAdminUser = {
  name: string;
  email: string;
  initials: string;
  userId: string;
  /** Foto de perfil do usuário logado (`profiles.avatar_url`), se houver. */
  avatarUrl: string | null;
};

const FALLBACK: CurrentAdminUser = { name: "Administrador", email: "", initials: "AD", userId: "", avatarUrl: null };

const CurrentUserContext = createContext<CurrentAdminUser | null>(null);

// Provided once by AdminShell (which already receives the real session name
// from app/admin/layout.tsx) so any screen under /admin can read who's
// actually logged in — e.g. comment authorship, or scoping
// GET /api/admin/notifications to this account — without prop-drilling
// through every intermediate board/modal component.
export function CurrentUserProvider({ user, children }: { user: CurrentAdminUser; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentAdminUser(): CurrentAdminUser {
  return useContext(CurrentUserContext) ?? FALLBACK;
}

// ---------------------------------------------------------------------------
// Fotos da equipe, indexadas por nome.
//
// Os comentários de tarefa gravam o autor como TEXTO congelado
// (`TaskComment.author` em lib/comments.ts), não como id de perfil — foi assim
// desde o começo, e é o que mantém os comentários antigos legíveis depois que
// uma conta é apagada. O preço é que a foto do autor só pode ser resolvida
// casando o nome, o que é best-effort por natureza:
//
//   - autor que não é pessoa ("Automação", "Sistema") nunca casa → iniciais;
//   - perfil renomeado depois do comentário não casa → iniciais;
//   - dois perfis homônimos casariam no mesmo → aceitável, e o fallback é
//     apenas a foto errada entre duas pessoas de mesmo nome, não vazamento.
//
// Em todos os casos o pior resultado é cair nas iniciais, que é exatamente o
// que a tela mostrava antes. Ver app/avatar/README.md.
// ---------------------------------------------------------------------------

export type TeamPhotoIndex = Record<string, string>;

const TeamPhotosContext = createContext<TeamPhotoIndex>({});

// Reexportada para quem já importa daqui; a implementação mora em
// app/avatar/photoKey.ts.
export { photoKey };

export function TeamPhotosProvider({ photos, children }: { photos: TeamPhotoIndex; children: React.ReactNode }) {
  return <TeamPhotosContext.Provider value={photos}>{children}</TeamPhotosContext.Provider>;
}

/** Foto de quem assina um comentário, ou null quando o nome não casa. */
export function useTeamPhoto(authorName: string | null | undefined): string | null {
  return useContext(TeamPhotosContext)[photoKey(authorName)] ?? null;
}
