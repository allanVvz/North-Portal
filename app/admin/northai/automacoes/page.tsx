import { listClients } from "@/lib/supabase";
import GlobalAutomationSettings from "../../automacoes/GlobalAutomationSettings";
import NorthAiTabs from "../NorthAiTabs";

export const dynamic = "force-dynamic";

export default async function NorthAiAutomacoesPage() {
  const clients = await listClients();
  return (
    <section className="admin-page kb-wide">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">North AI</h1>
          <p className="admin-sub">Publique regras globais por Tipo, Subtipo e etapa da cascata. Vincule cada regra no Plano, na Entrega ou na Tarefa.</p>
        </div>
      </header>
      <NorthAiTabs />
      <GlobalAutomationSettings clients={clients.map((client) => ({ slug: client.slug, name: client.name }))} />
    </section>
  );
}
