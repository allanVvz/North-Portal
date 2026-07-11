import { listClients, listReviewQueue } from "@/lib/supabase";
import { getSession } from "@/lib/supabase/auth";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export default async function RevisoesPage() {
  const [reviews, clients, session] = await Promise.all([listReviewQueue(), listClients(), getSession()]);
  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Fila de revisão · interno North</p>
          <h1 className="admin-title">Revisões</h1>
        </div>
      </header>
      <ReviewQueue
        initial={reviews}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
        currentUserId={session?.userId ?? ""}
      />
    </section>
  );
}
