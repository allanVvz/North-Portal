import { listClients } from "@/lib/supabase";
import AutomationSettings from "../../automacoes/AutomationSettings";
import NorthAiTabs from "../NorthAiTabs";

export const dynamic = "force-dynamic";

export default async function NorthAiAutomacoesPage() {
  const clients = await listClients();
  return (
    <section className="admin-page kb-wide">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">North AI</h1>
          <p className="admin-sub">Configure por cliente o Plano, a recorrência, as peças, as pastas e o trabalho que o North AI prepara.</p>
        </div>
      </header>
      <NorthAiTabs />
      <AutomationSettings clients={clients.map((client) => ({ slug: client.slug, name: client.name }))} />
    </section>
  );
}
