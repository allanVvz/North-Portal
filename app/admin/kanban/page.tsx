import { listClients } from "@/lib/supabase";
import KanbanBoard from "../KanbanBoard";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const clients = await listClients();
  return (
    <section className="admin-page kb-wide">
      {clients.length === 0 ? (
        <>
          <header className="admin-head"><div><h1 className="admin-title">Quadro de tarefas</h1></div></header>
          <p className="admin-empty">Cadastre um cliente para montar o quadro.</p>
        </>
      ) : (
        <KanbanBoard clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />
      )}
    </section>
  );
}
