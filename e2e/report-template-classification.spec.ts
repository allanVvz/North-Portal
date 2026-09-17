import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Read-only production regression: report templates are ordinary recurring
// Tasks. Only their dated `flow_parent` occurrence is an Entrega.
test("molde ativo de relatório abre como Tarefa recorrente, não Entrega", async ({ page }) => {
  test.setTimeout(90_000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.");
  const admin = createClient(url, key);

  const { data: config, error: configError } = await admin
    .from("automation_configs")
    .select("target_task_id,tasks!automation_configs_target_task_id_fkey(kind,subtype,recurrence_cadence,payload)")
    .eq("automation_key", "relatorio_trafego_semanal")
    .eq("active", true)
    .limit(1)
    .single();
  if (configError || !config) throw new Error(`Configuração de relatório ativa ausente: ${configError?.message}`);

  const target = config.tasks as unknown as {
    kind: string;
    subtype: string | null;
    recurrence_cadence: string | null;
    payload: Record<string, unknown> | null;
  };
  expect(target.kind).toBe("operacional");
  expect(target.subtype).toBeNull();
  expect(target.recurrence_cadence).toBeTruthy();
  expect(target.payload?.flow_parent).not.toBe(true);

  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });

  await page.goto(`/admin/operacao?task=${config.target_task_id}`);
  const modal = page.locator(".tm");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  // The Type attribute can be hidden by the user's modal layout. The
  // recurrence section and the absence of the delivery-parent badge are the
  // stable visual contract independent of that preference.
  await expect(modal.getByText(/Execuções da recorrência/)).toBeVisible();
  await expect(modal.locator(".tm-head-parentflag")).toHaveCount(0);
});
