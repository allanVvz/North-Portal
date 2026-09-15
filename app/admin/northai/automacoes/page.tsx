import { listClients } from "@/lib/supabase";
import AutomationSettings from "../../automacoes/AutomationSettings";

export const dynamic = "force-dynamic";

export default async function NorthAiAutomacoesPage() {
  const clients = await listClients();
  return <AutomationSettings clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />;
}
