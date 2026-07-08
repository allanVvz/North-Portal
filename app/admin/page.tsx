import Link from "next/link";
import { listClients } from "@/lib/supabase";
import ClientsTable from "./ClientsTable";

export const dynamic = "force-dynamic";

export default async function AdminClientsPage() {
  const clients = await listClients();
  const activeCount = clients.filter((c) => c.is_active).length;

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">Clientes</h1>
          <p className="admin-sub">
            Carteira da North · {activeCount} ativo{activeCount === 1 ? "" : "s"}
          </p>
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
