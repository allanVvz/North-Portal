// Clientes para o @ do Estúdio: id (a identidade), nome, e o que ajuda a
// reconhecer no picker (segmento e cidade do cadastro). Uma leitura na carga da
// página — o picker filtra localmente, sem request a cada tecla.

import { listClients } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export type NorthAiClientOption = { id: string; slug: string; name: string; segment: string | null; city: string | null };

export async function listNorthAiClients(): Promise<NorthAiClientOption[]> {
  const clients = await listClients();
  if (!clients.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_company_info")
    .select("client_id,segmento,cidade_uf")
    .in("client_id", clients.map((client) => client.id));
  // Segmento e cidade são só apoio visual: sem eles o picker mostra o nome.
  const info = new Map(((data ?? []) as { client_id: string; segmento: string | null; cidade_uf: string | null }[]).map((row) => [row.client_id, row]));
  return clients.map((client) => ({
    id: client.id,
    slug: client.slug,
    name: client.name,
    segment: info.get(client.id)?.segmento ?? null,
    city: info.get(client.id)?.cidade_uf ?? null,
  }));
}
