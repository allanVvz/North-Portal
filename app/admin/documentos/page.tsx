import { listClients, listDocuments } from "@/lib/supabase";
import DocumentsTable from "./DocumentsTable";

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  const [documents, clients] = await Promise.all([listDocuments(), listClients()]);
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Conteúdo</p>
          <h1 className="admin-title">Documentos</h1>
          <p className="admin-sub">Contratos, propostas, relatórios e materiais — visíveis ao cliente no portal.</p>
        </div>
      </header>
      <DocumentsTable initial={documents} clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />
    </section>
  );
}
