import { getProfileName, listAdminHomeSummary, listMyHomeFocus } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import AdminHome from "./AdminHome";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const session = await requireAdmin();
  const [summary, name, focus] = await Promise.all([
    listAdminHomeSummary(),
    getProfileName(session.userId),
    listMyHomeFocus(session.userId),
  ]);
  return <AdminHome summary={summary} focus={focus} userName={name} />;
}
