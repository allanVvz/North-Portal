import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

test("diária mostra Doc único e pastas em desktop e tela estreita", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
    "Configure credenciais dedicadas de E2E.");

  await page.goto("/login?next=%2Fadmin%2Fnorthai%2Fautomacoes");
  await page.getByLabel("E-mail").fill(ADMIN_EMAIL);
  await page.getByLabel("Senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/admin\/northai\/automacoes(?:\?|$)/, { timeout: 45_000 });

  const response = await page.request.get("/api/admin/automations/daily/options");
  expect(response.ok()).toBe(true);
  const options = await response.json() as { recurringPlans: Array<{ id: string; client_id: string | null }> };
  const plan = options.recurringPlans.find((item) => item.client_id);
  test.skip(!plan, "Nenhum Plano recorrente disponível para inspecionar o editor.");

  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.locator(".auto-type-select").last().selectOption("diaria_recorrente");
  const card = page.locator(".auto-card").first();
  await card.getByLabel("Cliente da diária").selectOption(plan!.client_id!);
  await card.getByLabel("Selecionar Plano recorrente").selectOption(plan!.id);
  await expect(card.getByLabel("Google Doc único do Roteiro")).toBeVisible();
  await expect(card.getByText(/North AI cria um Doc na pasta geral da diária/)).toBeVisible();
  const desktopPath = testInfo.outputPath("diaria-desktop.png");
  await card.screenshot({ path: desktopPath });
  await testInfo.attach("diaria-desktop", { path: desktopPath, contentType: "image/png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByLabel("Google Doc único do Roteiro")).toBeVisible();
  const mobilePath = testInfo.outputPath("diaria-mobile.png");
  await card.screenshot({ path: mobilePath });
  await testInfo.attach("diaria-mobile", { path: mobilePath, contentType: "image/png" });
});
