import { listActionPlans } from "@/lib/supabase";
import ActionPlansBoard from "./ActionPlansBoard";

export const dynamic = "force-dynamic";

export default async function PlanoPage() {
  const plans = await listActionPlans();
  return (
    <section className="admin-page">
      <ActionPlansBoard initial={plans} />
    </section>
  );
}
