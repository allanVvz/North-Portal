"use client";

import { createContext, useContext } from "react";

import { EMPTY_PHOTO_INDEX, findAuthorPhoto, type TeamPhotoIndex } from "../avatar/photoKey";

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
// Fotos da equipe.
//
// Montado uma vez por navegação em app/admin/layout.tsx e distribuído por
// contexto, no mesmo padrão do CurrentUserProvider acima — sem prop drilling
// por board e modal. A lógica de busca mora em app/avatar/photoKey.ts; aqui
// só a distribuição. Ver app/avatar/README.md.
// ---------------------------------------------------------------------------

const TeamPhotosContext = createContext<TeamPhotoIndex>(EMPTY_PHOTO_INDEX);

export function TeamPhotosProvider({ photos, children }: { photos: TeamPhotoIndex; children: React.ReactNode }) {
  return <TeamPhotosContext.Provider value={photos}>{children}</TeamPhotosContext.Provider>;
}

/** Foto de quem assina um comentário, ou null quando não é alguém da equipe. */
export function useAuthorPhoto(author: { author: string; author_id?: string }): string | null {
  return findAuthorPhoto(useContext(TeamPhotosContext), author);
}
