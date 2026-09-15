import { listClients } from "@/lib/supabase";
import AutomationSettings from "../../automacoes/AutomationSettings";
import NorthAiTabs from "../NorthAiTabs";

export const dynamic = "force-dynamic";

// A tela de Automações de sempre, agora como aba do NorthAi. Uma implementação
// só (AutomationSettings); /admin/automacoes redireciona para cá.
export default async function NorthAiAutomacoesPage() {
  const clients = await listClients();
  return (
    <section className="admin-page kb-wide">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">NorthAi</h1>
          <p className="admin-sub">Automações que rodam sozinhas nos cards dos clientes.</p>
        </div>
      </header>
      <NorthAiTabs />
      <AutomationSettings clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />
    </section>
  );
}
