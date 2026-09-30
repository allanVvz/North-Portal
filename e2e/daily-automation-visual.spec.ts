import { expect, test } from "@playwright/test";
import { openAdminSession } from "./adminSession";

test("Automações usa cards compactos e edição curta na própria tela", async ({ page }) => {
  test.setTimeout(90_000);
  await openAdminSession(page);
  await page.goto("/admin/northai/automacoes");
  await expect(page.locator(".global-automations")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Nova automação/ })).toBeVisible();
  await expect(page.getByText("Provisionar agora")).toHaveCount(0);
  await expect(page.getByText("Coleta de métricas com o cliente")).toHaveCount(0);
  await page.getByRole("button", { name: /Nova automação/ }).click();
  const editor = page.locator(".global-automations .auto-card").last();
  await expect(editor.getByText("1. Origem")).toBeVisible();
  await expect(editor.getByText("2. Gatilho")).toBeVisible();
  await expect(editor.getByText("3. Ação")).toBeVisible();
  await expect(editor.getByText("4. Saída")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(editor).toBeVisible();
});
