import { test, expect } from "@playwright/test";
import { openAdminSession } from "./adminSession";

test("regra de diária usa Tipo Plano e quantidades por Subtipo", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAdminSession(page);
  await page.goto("/admin/northai/automacoes");
  await page.getByRole("button", { name: /Nova automação/ }).click();
  const editor = page.locator(".global-automations .auto-card").last();
  await editor.getByRole("group", { name: "1. Origem" }).getByLabel("Tipo").selectOption({ label: "Plano" });
  await editor.getByRole("group", { name: "3. Ação" }).getByLabel("Executar").selectOption("daily");
  await expect(editor.locator(".global-daily-quantities")).toBeVisible();
  await expect(editor.getByText("O Plano pode ajustá-las")).toBeVisible();
  await expect(editor.getByText("Cliente da diária")).toHaveCount(0);
  await page.mouse.move(1200, 40);
  await page.screenshot({ path: testInfo.outputPath("daily-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(380, 40);
  await expect(editor.locator(".global-daily-quantities")).toBeVisible();
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
