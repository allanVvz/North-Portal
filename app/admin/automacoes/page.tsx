import { listClients } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import AutomationSettings from "./AutomationSettings";

export const dynamic = "force-dynamic";

export default async function AutomacoesPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");

  const clients = await listClients();
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">Automações</h1>
        </div>
      </header>
      <AutomationSettings clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />
    </section>
  );
}
