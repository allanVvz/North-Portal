import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { openAdminSession } from "./adminSession";

test.describe("Automações integradas (somente leitura)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => { await openAdminSession(page); });

  test("cascata mostra vínculo de automação e edição dentro do card de Tipo", async ({ page }) => {
    await page.goto("/admin/configuracoes?tab=fluxos");
    const delivery = page.locator(".voc-group", { has: page.getByRole("heading", { name: "Entrega", exact: true }) });
    await expect(delivery).toBeVisible({ timeout: 30_000 });
    const reels = delivery.locator(".voc-type", { hasText: "Reels" });
    await reels.locator(".voc-type-toggle").click();
    await expect(reels.getByRole("link", { name: "Vincular automação" }).first()).toBeVisible();
    await reels.getByRole("button", { name: "Editar cascata" }).click();
    await expect(reels.locator(".novofluxo-inline")).toBeVisible();
  });

  test("Roteiro principal da Baita pode ser conferido antes da próxima diária", async ({ page }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase E2E credentials are missing");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data: client, error: clientError } = await db.from("clients").select("id").eq("slug", "baita-conveniencia").single();
    if (clientError) throw clientError;
    const { data: plans, error: planError } = await db.from("tasks").select("id").eq("client_id", client.id).eq("kind", "plano_acao");
    if (planError) throw planError;
    const { data: config, error: configError } = await db.from("automation_configs").select("id")
      .in("target_task_id", (plans ?? []).map((plan) => plan.id)).eq("automation_key", "diaria_recorrente").single();
    if (configError) throw configError;
    const response = await page.request.get(`/api/admin/automations/daily/script-preflight?configId=${config.id}`);
    expect(response.ok()).toBe(true);
    const result = await response.json() as { pieceCount: number; scriptCount: number; ready: boolean; question: string | null };
    expect(result.pieceCount).toBe(12);
    expect(typeof result.ready).toBe("boolean");
    expect(result.scriptCount).toBeGreaterThanOrEqual(0);
  });
});
