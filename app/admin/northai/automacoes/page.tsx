import { listClients } from "@/lib/supabase";
import AutomationSettings from "../../automacoes/AutomationSettings";
import NorthAiTabs from "../NorthAiTabs";
import ScreenHeader from "../../ScreenHeader";

export const dynamic = "force-dynamic";

export default async function NorthAiAutomacoesPage() {
  const clients = await listClients();
  return (
    <section className="admin-page kb-wide">
      <ScreenHeader title="North AI" lede="Configure por cliente o Plano, a recorrência, as peças, as pastas e o trabalho que o North AI prepara." />
      <NorthAiTabs />
      <AutomationSettings clients={clients.map((client) => ({ slug: client.slug, name: client.name }))} />
    </section>
  );
}
