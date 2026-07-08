import { redirect } from "next/navigation";
import { getProfileName } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import AdminShell from "./AdminShell";

// Admin shell: gated by role (defense in depth alongside middleware).
// The interactive chrome (theme toggle + account panel) lives in AdminShell.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");

  const email = session.email ?? "";
  const profileName = await getProfileName(session.userId);
  const name = profileName ?? "Administrador";
  const initials = profileName
    ? profileName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : (email.split("@")[0] || "AD").slice(0, 2).toUpperCase();

  return (
    <AdminShell email={email} name={name} initials={initials}>
      {children}
    </AdminShell>
  );
}
