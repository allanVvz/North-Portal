import { createClient } from "./server";
import { HttpError } from "@/lib/validation";

export type SessionInfo = {
  userId: string;
  email: string | null;
  role: "admin" | "client" | null;
  clientId: string | null;
  clientSlug: string | null;
};

// Reads the current authenticated user + role from the session (RLS-safe).
export async function getSession(): Promise<SessionInfo | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const meta = user.app_metadata ?? {};
  return {
    userId: user.id,
    email: user.email ?? null,
    role: (meta.role as SessionInfo["role"]) ?? null,
    clientId: (meta.client_id as string | undefined) ?? null,
    clientSlug: (meta.client_slug as string | undefined) ?? null,
  };
}

// Throws 401/403 unless the caller is an admin.
export async function requireAdmin(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Nao autenticado.");
  if (session.role !== "admin") throw new HttpError(403, "Acesso restrito.");
  return session;
}

// Throws unless the caller is an admin or the owner client of `slug`.
export async function requireClientAccess(slug: string): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Nao autenticado.");
  if (session.role === "admin") return session;
  if (session.role === "client" && session.clientSlug === slug) return session;
  throw new HttpError(403, "Acesso restrito.");
}
