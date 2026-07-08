import { createClient } from "./server";
import { HttpError } from "@/lib/validation";

export type AccessLevel = "editor" | "gerente" | "usuario";

export type SessionInfo = {
  userId: string;
  email: string | null;
  role: "admin" | "client" | null;
  // Access level within the role — 'gerente' has elevated permission in
  // either role; 'editor' (admin) and 'usuario' (client) are the base level.
  level: AccessLevel | null;
  clientId: string | null;
  clientSlug: string | null;
};

type ProfileRow = {
  role: "admin" | "client";
  level: string | null;
  client_id: string | null;
  clients: { slug: string } | { slug: string }[] | null;
};

// Reads the current authenticated user + role/level from `profiles` — the
// same source of truth RLS uses (`is_admin()`/`current_client_id()`), not
// the JWT's app_metadata, which can lag behind for accounts created via
// `supabase.auth.admin.createUser()` (see auth-admin-build memory).
export async function getSession(): Promise<SessionInfo | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("role,level,client_id,clients(slug)")
    .eq("id", user.id)
    .limit(1);
  const p = (data?.[0] as ProfileRow | undefined) ?? null;
  const c = p ? (Array.isArray(p.clients) ? p.clients[0] : p.clients) : null;

  return {
    userId: user.id,
    email: user.email ?? null,
    role: p?.role ?? null,
    level: (p?.level as AccessLevel | null) ?? null,
    clientId: p?.client_id ?? null,
    clientSlug: c?.slug ?? null,
  };
}

// Throws 401/403 unless the caller is an admin.
export async function requireAdmin(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Nao autenticado.");
  if (session.role !== "admin") throw new HttpError(403, "Acesso restrito.");
  return session;
}

// Throws 401/403 unless the caller is an admin AND a 'gerente' — editors can
// see everything an admin can, but can't approve cards or register métricas.
export async function requireAdminManager(): Promise<SessionInfo> {
  const session = await requireAdmin();
  if (session.level !== "gerente") throw new HttpError(403, "Acao restrita a gerentes.");
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
