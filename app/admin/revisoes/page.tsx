import { listClients, listReviewQueue } from "@/lib/supabase";
import ReviewQueue from "./ReviewQueue";
import ScreenHeader from "../ScreenHeader";

export const dynamic = "force-dynamic";

export default async function RevisoesPage() {
  const [reviews, clients] = await Promise.all([listReviewQueue(), listClients()]);
  return (
    <section className="admin-page">
      <ScreenHeader title="Revisões" lede="Cards esperando revisão interna antes de seguir para o cliente." />
      <ReviewQueue
        initial={reviews}
        clients={clients.map((c) => ({ slug: c.slug, name: c.name }))}
      />
    </section>
  );
}
