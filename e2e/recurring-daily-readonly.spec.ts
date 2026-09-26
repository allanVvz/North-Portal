import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

test("catálogo e editor da diária em desktop e tela estreita", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await page.goto("/admin/northai/automacoes");
  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.locator(".auto-type-select").last().selectOption("diaria_recorrente");
  const planPicker = page.getByRole("combobox", { name: "Selecionar Plano recorrente" });
  await expect(planPicker).toBeVisible();
  // Never bind this read-only visual check to a real production Plan by list order.
  await expect(planPicker).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("daily-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".auto-daily, .auto-pick").last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("daily-narrow.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
