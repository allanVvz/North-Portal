"use client";

import { createContext, useContext } from "react";

export type CurrentAdminUser = { name: string; email: string; initials: string };

const FALLBACK: CurrentAdminUser = { name: "Administrador", email: "", initials: "AD" };

const CurrentUserContext = createContext<CurrentAdminUser | null>(null);

// Provided once by AdminShell (which already receives the real session name
// from app/admin/layout.tsx) so any screen under /admin can read who's
// actually logged in — e.g. comment authorship — without prop-drilling
// through every intermediate board/modal component.
export function CurrentUserProvider({ user, children }: { user: CurrentAdminUser; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentAdminUser(): CurrentAdminUser {
  return useContext(CurrentUserContext) ?? FALLBACK;
}
