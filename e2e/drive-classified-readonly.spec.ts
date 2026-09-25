import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

test("brutos classificados existentes aparecem na pasta do Criativo aberta pelo card", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  const indexResponse = await page.request.get("/api/admin/drive/baita/materials");
  expect(indexResponse.ok()).toBe(true);
  const index = await indexResponse.json() as { workspaces: Array<{ creative_task_id: string; assets: Array<{ id: string; role: string; state: string }>; raw_links: Array<{ asset_id: string }> }> };
  const target = index.workspaces.find((workspace) => workspace.raw_links.some((link) => workspace.assets.some((asset) => asset.id === link.asset_id && asset.role === "raw" && asset.state === "active")));
  test.skip(!target, "Nenhum bruto classificado no momento");

  await page.goto(`/admin/operacao?area=planos-entregas&task=${target!.creative_task_id}`);
  // O card não lista mais brutos (25/09): "Abrir arquivos" leva direto aos
  // classificados do próprio criativo, dentro do modal.
  const assetId = target!.raw_links.find((link) => target!.assets.some((asset) => asset.id === link.asset_id && asset.role === "raw" && asset.state === "active"))!.asset_id;
  await expect(page.locator(".tm-materials-open")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("classified-card-desktop.png") });
  await page.locator(".tm-materials-open").click();
  await expect(page.locator(".creative-drive-tabs button.on")).toContainText("Classificados");
  await expect(page.locator(`[data-classified-asset-id="${assetId}"]`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("classified-folder-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("classified-folder-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
