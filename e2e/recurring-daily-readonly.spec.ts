import { test, expect } from "@playwright/test";
import { openAdminSession } from "./adminSession";

test("catálogo e editor da diária em desktop e tela estreita", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAdminSession(page);
  await page.goto("/admin/northai/automacoes");
  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.locator(".auto-type-select").last().selectOption("diaria_recorrente");
  const clientPicker = page.getByLabel("Cliente da diária");
  await expect(clientPicker).toBeVisible();
  const baitaId = await clientPicker.locator("option").filter({ hasText: /BAITA/i }).getAttribute("value");
  expect(baitaId).toBeTruthy();
  await clientPicker.selectOption(baitaId!);
  const planPicker = page.getByRole("combobox", { name: "Selecionar Plano recorrente" });
  await expect(planPicker).toBeVisible();
  // Never bind this read-only visual check to a real production Plan by list order.
  await expect(planPicker).toHaveValue("");
  await page.mouse.move(1200, 40);
  await page.screenshot({ path: testInfo.outputPath("daily-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(380, 40);
  await expect(page.locator(".auto-daily, .auto-pick").last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("daily-narrow.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

  await page.goto("/admin/configuracoes?tab=fluxos");
  await expect(page.getByText("Formatos canônicos")).toHaveCount(0);
  const deliveryGroup = page.locator(".voc-group", { has: page.getByRole("heading", { name: "Entrega", exact: true }) });
  await expect(deliveryGroup).toBeVisible();
  const reels = deliveryGroup.locator(".voc-type", { hasText: "Reels" });
  await expect(reels).toBeVisible();
  await reels.locator(".voc-type-toggle").click();
  await expect(reels.getByRole("button", { name: "Editar cascata" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.mouse.move(1200, 40);
  await page.screenshot({ path: testInfo.outputPath("formats-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(380, 40);
  await page.screenshot({ path: testInfo.outputPath("formats-narrow.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
