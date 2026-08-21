import { safeTokenEquals } from "@/lib/api";
import { HttpError } from "@/lib/validation";

// Gate for app/api/admin/automations/run — called by pg_cron/pg_net
// (supabase/migrations/20260820000003_automation_cron.sql), which has no
// user session, so this checks a shared secret header (constant-time
// compare, same helper as the rest of the codebase) instead of
// requireAdmin(). CRON_SECRET must match the `app.cron_secret` GUC set on
// the Postgres side.
export async function requireCronSecret(request: Request): Promise<void> {
  const provided = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided || !(await safeTokenEquals(expected, provided))) throw new HttpError(401, "Nao autorizado.");
}
