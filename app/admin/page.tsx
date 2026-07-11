import Link from "next/link";
import { listAllBriefings, listClients } from "@/lib/supabase";
import ClientsTable, { type ClientRow } from "./ClientsTable";
import { clientStageFor } from "./clientPipeline";

export const dynamic = "force-dynamic";

export default async function AdminClientsPage() {
  const [summaries, briefings] = await Promise.all([
    listClients({ includeDisabled: true }),
    listAllBriefings(),
  ]);
  const checkpointsBySlug = new Map(briefings.map((b) => [b.slug, b.checkpointsPct]));
  const clients: ClientRow[] = summaries.map((c) => {
    const checkpointsPct = checkpointsBySlug.get(c.slug) ?? 0;
    return { ...c, checkpointsPct, stage: clientStageFor(c.briefing_submitted, checkpointsPct) };
  });
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Dados</p>
          <h1 className="admin-title">Clientes</h1>
        </div>
        <Link href="/admin/novo" className="admin-btn primary">
          + Novo cliente
        </Link>
      </header>

      {clients.length === 0 ? (
        <p className="admin-empty">Nenhum cliente ainda. Crie o primeiro.</p>
      ) : (
        <ClientsTable clients={clients} />
      )}
    </section>
  );
}
