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

  const card = page.locator(".auto-card").filter({ has: page.getByLabel("Google Doc único do Roteiro") }).first();
  await expect(card.getByLabel("Google Doc único do Roteiro")).toBeVisible();
  await expect(card.getByText(/North AI cria um Doc na pasta geral da diária quando ela estiver em um Drive compartilhado/)).toBeVisible();
  const desktopPath = testInfo.outputPath("diaria-desktop.png");
  await card.screenshot({ path: desktopPath });
  await testInfo.attach("diaria-desktop", { path: desktopPath, contentType: "image/png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByLabel("Google Doc único do Roteiro")).toBeVisible();
  const mobilePath = testInfo.outputPath("diaria-mobile.png");
  await card.screenshot({ path: mobilePath });
  await testInfo.attach("diaria-mobile", { path: mobilePath, contentType: "image/png" });
});
